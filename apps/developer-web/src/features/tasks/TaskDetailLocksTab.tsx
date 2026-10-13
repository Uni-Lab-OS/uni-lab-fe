import { clsx } from 'clsx'
import { useState } from 'react'
import { Button, Checkbox, Input, message } from 'antd'
import type { WorkflowTaskCommandReceipt, WorkflowTaskExecutionLock } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { useBackendQuery } from '../../hooks/useBackendQuery'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskDetailStyles from './taskDetail.module.scss'
import { DebugIcon } from './TaskDetailIcons'
import { buildTaskResourceUnlockCommand, taskResourceUnlockReadiness } from './taskLockPresentation'

const PHYSICAL_SAFETY_CONFIRMATION =
  '我已现场确认此 Task 涉及的设备均已停止，物理现场安全，物料状态已核实，且不存在未上报的在途动作。'

/** 一次「解锁意图」的请求体。同一意图的重试必须复用它的幂等键。 */
type UnlockRequest = ReturnType<typeof buildTaskResourceUnlockCommand>

type Outcome =
  | { kind: 'none' }
  /** 命令已接受但尚未确认生效 —— 不能当成成功。 */
  | { kind: 'pending' }
  /** OS 明确拒绝。detail 是中文原因（由 OS 回执的 `result.reason` 翻译而来）。 */
  | { kind: 'rejected'; detail: string }
  /** 命令回执为已生效。released 为 null 表示重读失败，没能确认释放数量。 */
  | { kind: 'done'; released: number | null }

/**
 * 任务级整组解锁（对齐 Uni-Lab OS 内置前端的执行锁面板）。
 *
 * 它和任务详情投影里的锁事实**不是同一份数据**：那份常常是空的，而整组解锁必须看
 * 任务真正持有的锁与设备占用，所以这里单独读专用端点。
 *
 * `unlock_resources` 是**调试场景**命令：它**不在 AGENTS.md 的生产共享 Runtime 命令
 * 白名单内**（白名单只有 step / pause / resume / cancel）。不要据此扩大生产命令面。
 */
export function LocksTab({
  taskUuid,
  cleanupStatus,
  onReloadTaskDetail,
}: {
  taskUuid: string | null
  /** 任务详情投影里的清理状态，用来识别「清理交接残留」这条本前端未接入的路径。 */
  cleanupStatus?: string | null
  /** 重读任务详情。解锁成功后必须调用：命令回执不能当终态。 */
  onReloadTaskDetail?: () => void | Promise<void>
}) {
  const { backend } = useBackend()
  const query = useBackendQuery(
    `task-execution-locks:${taskUuid ?? 'none'}`,
    async (client) => (taskUuid ? client.core.executionRead.getTaskExecutionLocks(taskUuid) : null),
    { live: true },
  )
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [pending, setPending] = useState(false)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'none' })
  // 幂等键在"同一次意图"里复用：说明或勾选变化都算新意图，避免重复下发命令。
  const [idempotencyKey, setIdempotencyKey] = useState('')
  // 保留本次意图的请求体：pending 时「确认原解锁请求结果」必须重放同一个请求，
  // 幂等键变了就不是同一次意图，后端会当成第二次解锁。
  const [submittedRequest, setSubmittedRequest] = useState<UnlockRequest | null>(null)

  const snapshot = query.data ?? null
  // 面板首先要回答的是「这个任务有锁没有」，所以先把这个量单独拿出来。
  const lockCount = snapshot?.locks.length ?? 0
  const hasResources = lockCount > 0 || (snapshot?.activeDeviceTenancyCount ?? 0) > 0
  const readiness = taskResourceUnlockReadiness({
    taskStatus: snapshot?.taskStatus ?? null,
    lockCount: snapshot?.locks.length ?? 0,
    activeDeviceTenancyCount: snapshot?.activeDeviceTenancyCount ?? 0,
    cleanupStatus,
    // 人工复核关注点是否了结在 controller 里拿不到；缺省时门禁退化到 blocked，
    // 只会更保守（多拦一次），不会误开放解锁。
    manualReviewAttentionResolved: undefined,
  })
  const canSubmit = readiness.kind === 'ready' && reason.trim().length > 0 && confirmed && !pending

  /**
   * 下发（或按同一幂等键重放）一次解锁命令。
   *
   * `beforeLockCount` 是这次请求发出前快照里的锁数量，用来和重读结果做差得出「释放了几把」——
   * 不能拿它直接当成已释放数量：命令生效不等于锁真的没了。
   */
  const send = async (request: UnlockRequest, beforeLockCount: number) => {
    if (!taskUuid) return
    setPending(true)
    try {
      const receipt = await backend.core.executionControl.sendTaskCommand(taskUuid, request)
      if (receipt.lifecycle === 'rejected') {
        // 拒绝是终态答复：本次意图结束，幂等键不再复用，并且必须重新勾选现场确认，
        // 否则用户会不看原因就再点一次。
        setSubmittedRequest(null)
        setConfirmed(false)
        const detail = describeUnlockRejection(receipt)
        setOutcome({ kind: 'rejected', detail })
        message.error('整组解锁被 OS 拒绝')
        return
      }
      if (receipt.lifecycle !== 'applied') {
        // HTTP 接受 / 命令回执都不等于资源已释放：如实停在"处理中"，并保留本次请求。
        setOutcome({ kind: 'pending' })
        return
      }
      // 命令生效 ≠ 锁已释放：必须重读权威投影。GET 是幂等的，而 useBackendQuery.reload
      // 只更新状态、不回传值，所以这里直接再读一次拿"还剩几把锁"，随后 reload 让列表刷新。
      let remaining: number | null = null
      try {
        const refreshed = await backend.core.executionRead.getTaskExecutionLocks(taskUuid)
        remaining = refreshed.locks.length
      } catch {
        remaining = null
      }
      query.reload()
      await onReloadTaskDetail?.()
      setOutcome({
        kind: 'done',
        // beforeLockCount 为 0 说明这次要解的是设备占用而不是执行锁，说「已释放 0 把执行锁」
        // 只会误导；这时不给数字，让用户以刷新后的列表为准。
        released:
          remaining === null || beforeLockCount === 0
            ? null
            : Math.max(beforeLockCount - remaining, 0),
      })
      setReason('')
      setConfirmed(false)
      setIdempotencyKey('')
      setSubmittedRequest(null)
    } catch (error) {
      // 请求根本没送到 OS：不能声称已释放，也不能声称被拒绝。
      message.error(error instanceof Error ? error.message : '整组解锁失败')
    } finally {
      setPending(false)
    }
  }

  const submit = async () => {
    if (!taskUuid || !canSubmit) return
    const key = idempotencyKey || `studio-${taskUuid}-unlock-${Date.now()}`
    setIdempotencyKey(key)
    const request = buildTaskResourceUnlockCommand({
      idempotencyKey: key,
      description: reason.trim(),
    })
    setSubmittedRequest(request)
    await send(request, snapshot?.locks.length ?? 0)
  }

  /**
   * 确认原解锁请求结果。
   *
   * core 的控制端口只有 `sendTaskCommand`，**没有**「读命令状态」的接口，所以确认结果只能靠
   * 用**同一个幂等键**重放同一个请求体：后端按幂等键去重，重放不会二次解锁，回执会给出这次
   * 命令当前的真实结果（accepted / applied / rejected）。
   */
  const confirmSubmittedResult = () => {
    if (!submittedRequest) return
    void send(submittedRequest, snapshot?.locks.length ?? 0)
  }

  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      {/*
        没有任何可解资源时**只说这一句**：此时解释「为什么不能整组解锁」没有意义，
        空态已经说完了。门禁横幅、锁列表、确认表单都只在确实有东西可解时才出现。
      */}
      {!snapshot ? (
        // 还没读到快照（读取中 / 读取失败）时不能套用「暂无执行锁」这句结论 ——
        // 那是替一个没读到的接口下结论。只有确实读回了空快照才说没有锁。
        <div
          className={clsx(
            taskDetailInspectorStyles['debug-empty-state'],
            taskDetailInspectorStyles['debug-lock-empty-state'],
          )}
        >
          {query.error ? `读取执行锁快照失败：${query.error.message}` : '正在读取执行锁快照…'}
          {/* 只有"读不到"这一支给重读入口：那时重读是真的可能成功的。 */}
          {query.error && (
            <Button size="small" type="link" onClick={() => query.reload()}>
              重新读取锁状态
            </Button>
          )}
        </div>
      ) : !hasResources ? (
        <div
          className={clsx(
            taskDetailInspectorStyles['debug-empty-state'],
            taskDetailInspectorStyles['debug-lock-empty-state'],
          )}
        >
          暂无执行锁。
        </div>
      ) : (
        <>
          <div
            className={clsx(
              taskDetailInspectorStyles['debug-lock-guard'],
              readiness.kind === 'ready' ? taskDetailInspectorStyles['is-ready'] : '',
            )}
          >
            <div className={clsx(taskDetailInspectorStyles['debug-lock-guard-head'])}>
              <DebugIcon name={readiness.kind === 'ready' ? 'unlock' : 'shield-alert'} size={18} />
              <div>
                {/* 用户打开这个 tab 先要知道「有锁没有」。所以首行回答持有情况，
                    门禁说明降为下面的补充（有资源却仍不能解锁时必须说清为什么）。 */}
                <strong>
                  {readiness.kind === 'ready'
                    ? `持有 ${lockCount} 把执行锁，可整组解锁`
                    : `持有 ${lockCount} 把执行锁`}
                </strong>
                {readiness.kind !== 'ready' && <p>{readiness.reason}</p>}
              </div>
            </div>
          </div>

          <div className={clsx(taskDetailInspectorStyles['debug-lock-group'])}>
            {snapshot?.locks.map((lock) => (
              <LockRow key={lock.uuid} lock={lock} />
            ))}
          </div>

          {snapshot && snapshot.activeDeviceTenancyCount > 0 && (
            <p className={clsx(taskDetailInspectorStyles['debug-lock-guard'])}>
              另有 {snapshot.activeDeviceTenancyCount} 项设备占用会一并解除。
            </p>
          )}

          {readiness.kind === 'ready' && (
            <div className={clsx(taskDetailInspectorStyles['debug-lock-actions'])}>
              <label>
                <span>
                  解锁说明<em>必填</em>
                </span>
                <Input.TextArea
                  rows={3}
                  value={reason}
                  disabled={pending}
                  placeholder="说明设备已停止、无在途动作和现场物料核验情况。"
                  onChange={(event) => {
                    setReason(event.target.value)
                    setIdempotencyKey('')
                  }}
                />
              </label>
              <Checkbox
                checked={confirmed}
                disabled={pending}
                onChange={(event) => {
                  setConfirmed(event.target.checked)
                  setIdempotencyKey('')
                }}
              >
                {PHYSICAL_SAFETY_CONFIRMATION}
              </Checkbox>
              <Button
                danger
                size="small"
                loading={pending}
                disabled={!canSubmit}
                onClick={() => void submit()}
              >
                {readiness.label}
              </Button>
            </div>
          )}
        </>
      )}

      {/* 收尾提示必须在 hasResources 判断之外：解锁成功后 locks 会变成 0，
          这时「已释放 N 把执行锁」仍然必须可见。 */}
      {outcome.kind === 'pending' && (
        <div className={clsx(taskDetailInspectorStyles['debug-lock-guard'])} role="status">
          <div className={clsx(taskDetailInspectorStyles['debug-lock-guard-head'])}>
            <DebugIcon name="shield-alert" size={18} />
            <div>
              <strong>解锁命令仍在处理中，尚未确认资源释放</strong>
              <span>
                OS 只是持久化受理了这条命令。确认结果会用同一个幂等键重放本次请求，后端按幂等键
                去重，不会二次解锁。
              </span>
            </div>
          </div>
          <Button size="small" loading={pending} onClick={confirmSubmittedResult}>
            确认原解锁请求结果
          </Button>
          <Button size="small" type="link" onClick={() => query.reload()}>
            重新读取锁状态
          </Button>
        </div>
      )}
      {outcome.kind === 'rejected' && (
        <div className={clsx(taskDetailInspectorStyles['debug-lock-guard'])} role="alert">
          <div className={clsx(taskDetailInspectorStyles['debug-lock-guard-head'])}>
            <DebugIcon name="shield-alert" size={18} />
            <div>
              <strong>整组解锁被 OS 拒绝</strong>
              {/* 拒绝原因来自回执的 result.reason，必须原样说清，不能只给一句通用文案。 */}
              <span>{outcome.detail}</span>
            </div>
          </div>
        </div>
      )}
      {outcome.kind === 'done' && (
        <div
          className={clsx(
            taskDetailInspectorStyles['debug-lock-guard'],
            taskDetailInspectorStyles['is-ready'],
          )}
          role="status"
        >
          <div className={clsx(taskDetailInspectorStyles['debug-lock-guard-head'])}>
            <DebugIcon name="unlock" size={18} />
            <div>
              <strong>
                {outcome.released === null
                  ? '整组解锁命令已生效；锁状态以刷新后的列表为准'
                  : `已释放 ${outcome.released} 把执行锁；锁状态以刷新后的列表为准`}
              </strong>
              <span>
                {outcome.released === null
                  ? '命令回执为已生效，但重读锁快照失败，没能确认释放数量；请重新读取核对。'
                  : '命令回执只说明命令生效，释放数量来自重读后的锁快照。'}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function LockRow({ lock }: { lock: WorkflowTaskExecutionLock }) {
  const tone = lock.state === 'released' ? 'ready' : lock.state === 'uncertain' ? 'unknown' : 'held'
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-lock-row'])}>
      <span>
        <strong>{lock.lockKey || lock.uuid}</strong>
        <small>
          {lock.scope || '未知范围'}
          {lock.workflowNodeJobUuid ? ` · 节点 ${lock.workflowNodeJobUuid.slice(0, 8)}` : ''}
        </small>
        {/*
          `canRelease` 只是**这一把锁**能不能释放，不是整个任务能不能整组解锁；
          两者必须分开说，否则又会把门禁说错。OS 给的 releaseBlockReason 比状态名更能行动。
        */}
        {lock.canRelease ? (
          <small className={clsx(taskDetailInspectorStyles['lock-ready'])}>
            OS 判定这把锁可以释放
          </small>
        ) : (
          <small className={clsx(taskDetailInspectorStyles['lock-held'])}>
            OS 判定这把锁暂不可释放
            {lock.releaseBlockReason ? `：${lock.releaseBlockReason}` : '（OS 未给出原因）'}
          </small>
        )}
      </span>
      <span
        className={clsx(
          tone === 'ready'
            ? taskDetailInspectorStyles['lock-ready']
            : tone === 'unknown'
              ? taskDetailInspectorStyles['lock-unknown']
              : taskDetailInspectorStyles['lock-held'],
        )}
      >
        <span className={clsx(taskDetailStyles['debug-state-dot'])} />
        {/* 未知取值如实透传，不在前端折叠成枚举；原始 token 放在 title 里。 */}
        <span title={lock.state}>{describeLockState(lock.state)}</span>
      </span>
    </div>
  )
}

/** 只翻译已知状态，未知取值原样显示。 */
function describeLockState(state: string): string {
  switch (state) {
    case 'reserved':
      return '已预留'
    case 'running':
      return '执行中'
    case 'released':
      return '已释放'
    case 'uncertain':
      return '状态不明'
    case 'unknown':
      return '状态不明'
    default:
      return state || '未知'
  }
}

/** OS 的拒绝原因原样带在回执的 `result.reason` 上；常见取值给中文，未知取值如实转述。 */
const UNLOCK_REJECTION_DETAILS: Readonly<Record<string, string>> = {
  task_is_not_abnormal_terminal: '任务不是异常终态，不能整组解锁',
}

function describeUnlockRejection(receipt: WorkflowTaskCommandReceipt): string {
  const reason = typeof receipt.result.reason === 'string' ? receipt.result.reason.trim() : ''
  if (!reason) {
    return 'OS 拒绝了整组解锁命令，但没有返回原因；请到 Uni-Lab OS 控制台核对任务与资源状态。'
  }
  return UNLOCK_REJECTION_DETAILS[reason] ?? `OS 拒绝了整组解锁命令：${reason}`
}
