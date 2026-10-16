import { clsx } from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, Input, Modal, Popconfirm, Select, Space, Tag } from 'antd'
import type { StationError, StationErrorAction, StationHandlingSnapshot } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'
import { navigateTo } from '../../app/navigation'
import { useStationHandling, type StationHandlingState } from './useStationHandling'
import styles from './StationErrorHandling.module.scss'

/**
 * 全局工站错误处置：节点出错后 OS 暂停整个工站的新派发，在任何页面顶部提示，
 * 打开对话框逐条做决定（取消当前任务 / 重试当前节点 / 进入手动处理），手动处理完成后
 * 再决定，最后在确认现场后恢复调度。状态以每次提交后重读的 OS 快照为准。
 */
export function StationErrorHandling() {
  const state = useStationHandling()
  const [open, setOpen] = useState(false)
  const seen = useRef(new Set<string>())
  const snapshot = state.snapshot
  const errors = snapshot?.errors ?? []
  const pendingCommands = snapshot?.controlCommands.filter((command) => command.needsApply) ?? []
  const needsAttention =
    snapshot?.mode === 'PAUSED' || errors.length > 0 || pendingCommands.length > 0 || Boolean(state.unconfirmed)

  // 出现新的错误或阶段变化时自动打开一次；之后由操作员决定何时关闭。
  useEffect(() => {
    const fresh = errors.filter((error) => !seen.current.has(`${error.decisionId}:${error.stage}`))
    errors.forEach((error) => seen.current.add(`${error.decisionId}:${error.stage}`))
    if (fresh.length) setOpen(true)
  }, [errors])

  if (!state.available) return null
  if (!needsAttention && !state.readError) return null
  return (
    <>
      <div className={clsx(styles.banner)} role="status">
        <div>
          <strong>
            {state.readError
              ? '工站错误处置状态暂不可用'
              : snapshot?.mode === 'PAUSED'
                ? '工站调度已暂停'
                : '还有节点错误待处理'}
          </strong>
          <span>
            {state.readError
              ? `${state.readError}。写操作已暂停，可刷新重试。`
              : snapshot?.mode === 'PAUSED'
                ? `${errors.length} 条错误待处理；等待中的节点暂停派发，已开始的动作继续运行。`
                : `${errors.length} 条错误待处理；工站已恢复调度，出错任务仍等待决定。`}
          </span>
        </div>
        <Space>
          <Button onClick={() => void state.reload()}>刷新</Button>
          <Button type="primary" onClick={() => setOpen(true)}>
            {snapshot?.activeSession?.stage === 'MANUAL_HANDLING' ? '继续手动处理' : '处理节点错误'}
          </Button>
        </Space>
      </div>
      {open && <StationErrorDialog state={state} onClose={() => setOpen(false)} />}
    </>
  )
}

function StationErrorDialog({ state, onClose }: { state: StationHandlingState; onClose: () => void }) {
  const { backend } = useBackend()
  const port = backend.core.stationErrorHandling
  const snapshot = state.snapshot
  const errors = snapshot?.errors ?? []
  const [decisionId, setDecisionId] = useState<string | null>(null)
  const session = snapshot?.activeSession ?? null
  const selected =
    errors.find((error) => error.decisionId === decisionId) ??
    errors.find((error) => error.decisionId === session?.decisionId) ??
    errors[0] ??
    null
  const manual = Boolean(session && session.stage === 'MANUAL_HANDLING' && session.decisionId === selected?.decisionId)
  const writable = Boolean(snapshot) && !state.readError && !state.submitting && !state.unconfirmed

  return (
    <Modal
      open
      width={760}
      title={manual ? '人工处置' : errors.length ? '节点执行出错' : '确认恢复工站调度'}
      onCancel={() => !state.submitting && onClose()}
      footer={
        <span className={clsx(styles.footer)}>
          {state.submitting
            ? '正在提交，请等待…'
            : snapshot?.mode === 'PAUSED'
              ? '关闭后工站仍保持暂停，可从页面顶部重新打开。'
              : '以 OS 返回的最新状态为准。'}
          <Button disabled={state.submitting} onClick={onClose}>
            稍后处理
          </Button>
        </span>
      }
    >
      <div className={clsx(styles.body)}>
        <p className={clsx(styles.scope)}>暂停范围：当前工站（{snapshot?.stationId ?? '—'}）的全部工作流任务。</p>
        {state.readError && <Alert type="error" showIcon message="读取工站状态失败，写操作已暂停" description={state.readError} />}
        {state.submitError && <Alert type="error" showIcon message={state.submitError} />}
        {state.unconfirmed && (
          <Alert
            type="warning"
            showIcon
            message={`${state.unconfirmed.label}：结果待确认`}
            description="上次提交没有得到明确结果。将按原请求身份重发，不会创建第二条操作。"
            action={
              <Button size="small" disabled={state.submitting} onClick={() => void state.retryUnconfirmed()}>
                确认原请求结果
              </Button>
            }
          />
        )}
        {!snapshot ? (
          <p>正在读取工站状态…</p>
        ) : (
          <>
            {errors.length > 1 && (
              <label className={clsx(styles.field)}>
                <span>待处理错误（{errors.length}）</span>
                <Select
                  value={selected?.decisionId}
                  onChange={setDecisionId}
                  options={errors.map((error) => ({
                    value: error.decisionId,
                    label: `${error.sourceTaskUuid.slice(0, 8)} · ${error.message.slice(0, 40) || '节点执行失败'}`,
                  }))}
                />
              </label>
            )}
            {selected && <ErrorContext error={selected} />}
            {snapshot.controlCommands
              .filter((command) => command.needsApply)
              .map((command) => (
                <Alert
                  key={command.commandUuid}
                  type="info"
                  showIcon
                  message="操作已受理，等待应用"
                  description={`${command.operation} · ${command.commandUuid}`}
                  action={
                    <Button
                      size="small"
                      disabled={!writable}
                      onClick={() => void state.submit(port.applyCommandIntent(command.commandUuid))}
                    >
                      继续应用
                    </Button>
                  }
                />
              ))}
            {manual && session ? (
              <ManualSession snapshot={snapshot} state={state} writable={writable} />
            ) : (
              <DecisionPanel key={`${snapshot.snapshotId}:${selected?.decisionId}`} snapshot={snapshot} error={selected} state={state} writable={writable} />
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

function ErrorContext({ error }: { error: StationError }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={clsx(styles.context)}>
      <Space size={6} wrap>
        <Tag color="red">节点执行出错</Tag>
        <Tag>{error.stage === 'DECISION_REQUIRED' ? '待决定' : error.stage === 'MANUAL_HANDLING' ? '人工处置中' : error.stage === 'APPLYING' ? '正在应用' : error.stage}</Tag>
      </Space>
      <p className={clsx(styles.message)}>{error.message || '节点执行失败，请检查现场。'}</p>
      <details>
        <summary>任务与执行记录</summary>
        <code>Task：{error.sourceTaskUuid}</code>
        <code>Job：{error.sourceJobUuid}</code>
        <Space>
          <Button size="small" type="link" onClick={() => navigateTo('tasks', `?task=${encodeURIComponent(error.sourceTaskUuid)}`)}>
            打开任务
          </Button>
          <Button
            size="small"
            type="link"
            onClick={() => {
              void navigator.clipboard?.writeText(error.sourceJobUuid).then(() => setCopied(true))
            }}
          >
            {copied ? '已复制作业号' : '复制作业号'}
          </Button>
        </Space>
      </details>
    </div>
  )
}

function DecisionPanel({
  snapshot,
  error,
  state,
  writable,
}: {
  snapshot: StationHandlingSnapshot
  error: StationError | null
  state: StationHandlingState
  writable: boolean
}) {
  const { backend } = useBackend()
  const port = backend.core.stationErrorHandling
  const [confirmed, setConfirmed] = useState(false)
  const [reason, setReason] = useState('')
  const session = snapshot.activeSession
  const anotherSession = Boolean(session && error && session.decisionId !== error.decisionId)
  const offered = useMemo(() => new Set(error?.options.map((option) => option.id) ?? []), [error])
  const decide = (action: StationErrorAction) =>
    error && void state.submit(port.decisionIntent(snapshot, error, action, { resume: confirmed, reason }))

  if (error?.stage === 'APPLYING') return <p className={clsx(styles.note)}>当前选择已受理，正在应用，请等待处理结果。</p>
  if (anotherSession) return <p className={clsx(styles.note)}>另一条错误正在人工处置，请先完成该会话。</p>
  return (
    <section className={clsx(styles.decision)}>
      {session && error && session.decisionId === error.decisionId && (
        <p className={clsx(styles.note)}>现场处理已完成，调度仍暂停。请选择重试当前节点或取消当前任务。</p>
      )}
      {error ? (
        <label className={clsx(styles.field)}>
          <span>处理说明（选填，会记入 OS）</span>
          <Input.TextArea rows={2} value={reason} disabled={!writable} onChange={(event) => setReason(event.target.value)} />
        </label>
      ) : (
        <p>当前错误已处理。确认现场状态后，可恢复工作流调度。</p>
      )}
      <Checkbox checked={confirmed} disabled={!writable} onChange={(event) => setConfirmed(event.target.checked)}>
        我已核对现场，确认可以恢复工站工作流调度
      </Checkbox>
      <p className={clsx(styles.hint)}>
        {confirmed
          ? '本次处理应用后恢复调度；其他待处理错误仍需各自决定，新错误会再次暂停工站。'
          : snapshot.mode === 'PAUSED'
            ? '未勾选时，重试或取消的选择会保留，工站继续暂停，可稍后确认恢复。'
            : '工站当前正在调度，其他出错任务仍等待各自的决定。'}
      </p>
      <Space wrap>
        {error ? (
          <>
            {offered.has('cancel_task') && (
              <Popconfirm title="取消当前任务？任务将终止，后续步骤不会执行。" okText="确认取消" cancelText="再看看" onConfirm={() => decide('cancel_task')}>
                <Button danger disabled={!writable}>
                  取消当前任务
                </Button>
              </Popconfirm>
            )}
            {offered.has('retry_current_node') && (
              <Popconfirm title="重试当前节点？请确认现场已具备重新执行的条件。" okText="确认重试" cancelText="再看看" onConfirm={() => decide('retry_current_node')}>
                <Button type="primary" disabled={!writable}>
                  重试当前节点
                </Button>
              </Popconfirm>
            )}
            {session && session.decisionId === error.decisionId ? (
              <Button disabled={!writable} onClick={() => void state.submit(port.returnToSessionIntent(snapshot, session))}>
                返回手动处理
              </Button>
            ) : (
              offered.has('enter_manual_handling') && (
                <Button disabled={!writable} onClick={() => decide('enter_manual_handling')}>
                  进入手动处理
                </Button>
              )
            )}
          </>
        ) : (
          <Button
            type="primary"
            disabled={!writable || !confirmed || snapshot.mode !== 'PAUSED'}
            onClick={() => void state.submit(port.resumeIntent(snapshot))}
          >
            恢复工站调度
          </Button>
        )}
      </Space>
    </section>
  )
}

function ManualSession({
  snapshot,
  state,
  writable,
}: {
  snapshot: StationHandlingSnapshot
  state: StationHandlingState
  writable: boolean
}) {
  const { backend } = useBackend()
  const port = backend.core.stationErrorHandling
  const session = snapshot.activeSession!
  const [summary, setSummary] = useState(session.summary)
  const actions = snapshot.manualActions.filter((action) => action.sessionId === session.sessionId)
  const running = actions.filter((action) => ['pending', 'dispatched', 'running'].includes(action.status)).length
  const unresolved = actions.filter((action) => action.uncertaintyReason && !action.resultReviewed).length
  return (
    <section className={clsx(styles.decision)}>
      <Alert
        type="info"
        showIcon
        message="人工处置中，工站保持暂停"
        description="请在现场处理问题（例如人工取下板、复位机构）。完成后填写处理说明并点“完成手动处理”，再选择重试或取消。本前端暂不支持在会话中下发手动设备动作。"
      />
      {actions.length > 0 && (
        <p className={clsx(styles.hint)}>
          本次会话手动动作 {actions.length} 个：{running} 个未结束，{unresolved} 个结果待核对。
        </p>
      )}
      <label className={clsx(styles.field)}>
        <span>处理说明（会记入 OS）</span>
        <Input.TextArea rows={3} value={summary} maxLength={20000} disabled={!writable} onChange={(event) => setSummary(event.target.value)} />
      </label>
      <Button
        type="primary"
        disabled={!writable || running > 0 || unresolved > 0}
        onClick={() => void state.submit(port.completeSessionIntent(snapshot, session, summary))}
      >
        完成手动处理
      </Button>
    </section>
  )
}
