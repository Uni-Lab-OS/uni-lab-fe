import { clsx } from 'clsx'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import taskDetailStyles from './taskDetail.module.scss'
import type {
  NodeJobFeedbackPage,
  WorkflowExecutionLockFact,
  WorkflowNodeJobDetail,
  WorkflowRecoveryFact,
  WorkflowResourceWaitFact,
} from '@unilab-fe/core'

import { DebugIcon } from './TaskDetailIcons'
import {
  type TimelineEvent,
  formatJson,
  hasWorkflowSiteFact,
  readExpectedChangeSetKind,
} from './taskDetailModel'

export function EvidenceTab({
  event,
  job,
}: {
  event: TimelineEvent
  job: {
    readonly param: Readonly<Record<string, unknown>>
    readonly returnInfo: Readonly<Record<string, unknown>>
    readonly attempt: number
  } | null
}) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div className={clsx(taskDetailInspectorStyles['debug-detail-section'])}>
        <div className={clsx(taskDetailStyles['debug-detail-section-head'])}>
          <h3>运行输入</h3>
        </div>
        <pre className={clsx(taskDetailInspectorStyles['debug-code-block'])}>
          {formatJson(job?.param ?? {})}
        </pre>
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-detail-section'])}>
        <div className={clsx(taskDetailStyles['debug-detail-section-head'])}>
          <h3>当前输出</h3>
        </div>
        <pre
          className={clsx(
            taskDetailInspectorStyles['debug-code-block'],
            taskDetailInspectorStyles['debug-output-block'],
          )}
        >
          {formatJson(job?.returnInfo ?? {})}
        </pre>
        <dl className={clsx(taskDetailInspectorStyles['debug-output-meta'])}>
          <div>
            <dt>反馈</dt>
            <dd>{event.status === 'success' ? '已返回成功状态' : '尚未形成终态回执'}</dd>
          </div>
          <div>
            <dt>尝试次数</dt>
            <dd>{job?.attempt ?? '—'}</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

export function ResourcesTab({
  waits,
  job,
}: {
  waits: readonly WorkflowResourceWaitFact[]
  job: WorkflowNodeJobDetail | null
}) {
  const actualExecutor =
    job?.controlData.actual_executor &&
    typeof job.controlData.actual_executor === 'object' &&
    !Array.isArray(job.controlData.actual_executor)
      ? (job.controlData.actual_executor as Readonly<Record<string, unknown>>)
      : null
  const dispatchPayload =
    job?.controlData.dispatch_payload &&
    typeof job.controlData.dispatch_payload === 'object' &&
    !Array.isArray(job.controlData.dispatch_payload)
      ? (job.controlData.dispatch_payload as Readonly<Record<string, unknown>>)
      : null
  const materialUuid =
    typeof actualExecutor?.material_uuid === 'string' ? actualExecutor.material_uuid : null
  const deviceId =
    typeof actualExecutor?.local_device_id === 'string'
      ? actualExecutor.local_device_id
      : typeof dispatchPayload?.device_id === 'string'
        ? dispatchPayload.device_id
        : null
  const changeSet = readExpectedChangeSetKind(job)
  const noInventoryChange = changeSet === 'no_inventory_change'
  const showSiteMap = hasWorkflowSiteFact(job, waits)
  const statusMessage =
    job?.status === 'pending'
      ? '节点尚未到达，OS 尚未产生资源等待事实。'
      : waits.length === 0
        ? 'OS 未返回 resource_waits；当前节点没有处于资源等待。'
        : null
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div className={clsx(taskDetailInspectorStyles['debug-resource-summary'])}>
        <span>
          <DebugIcon name="cube" size={17} />
          <b>{waits.length}</b> 项待分配资源
        </span>
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-resource-list'])}>
        {waits.length === 0 ? (
          <div
            className={clsx(
              taskDetailInspectorStyles['debug-empty-state'],
              taskDetailInspectorStyles['debug-resource-empty-state'],
            )}
          >
            暂无资源等待。
          </div>
        ) : (
          waits.map((wait, index) => (
            <ResourceRow
              key={`${wait.resourceUuid ?? 'resource'}-${index}`}
              icon="cube"
              title={wait.resourceUuid ?? '未命名资源'}
              meta={wait.resourceKind ?? '未知类型'}
              state={wait.reason ?? '等待'}
            />
          ))
        )}
      </div>
      {(statusMessage || materialUuid || deviceId || noInventoryChange) && (
        <div className={clsx(taskDetailInspectorStyles['debug-resource-diagnostic'])} role="status">
          <DebugIcon name="info" size={15} />
          <div>
            <strong>资源事实</strong>
            {statusMessage && <p>{statusMessage}</p>}
            {deviceId && <small>执行设备：{deviceId}</small>}
            {materialUuid && <small>执行器物料：{materialUuid}</small>}
            {noInventoryChange && (
              <small>变化类型：no_inventory_change（不产生物料库位占用，因此不展示库位图）</small>
            )}
          </div>
        </div>
      )}
      {showSiteMap && (
        <div className={clsx(taskDetailInspectorStyles['debug-site-choice'])}>
          <h3>库位图</h3>
          <div
            className={clsx(taskDetailInspectorStyles['debug-site-map-unavailable'])}
            role="status"
          >
            <DebugIcon name="layout-grid" size={15} />
            <span>OS 已返回 Site 事实，但当前检查面板尚未接入可绘制的库位图数据。</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function IssuesTab({ event }: { event: TimelineEvent }) {
  const intervention = event.status === 'manual'
  const unknown = event.status === 'unknown'
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div
        className={clsx(
          taskDetailInspectorStyles['debug-intervention-card'],
          intervention
            ? 'debug-intervention-manual'
            : unknown
              ? taskDetailInspectorStyles['debug-intervention-unknown']
              : taskDetailInspectorStyles['debug-intervention-waiting'],
        )}
      >
        <div className={clsx(taskDetailInspectorStyles['debug-intervention-title'])}>
          <DebugIcon
            name={intervention ? 'user-check' : unknown ? 'help-circle' : 'info'}
            size={18}
          />
          <div>
            <strong>
              {intervention
                ? '需要人工确认'
                : unknown
                  ? '结果待核对'
                  : event.status === 'waiting'
                    ? '等待资源'
                    : '没有待处理异常'}
            </strong>
          </div>
        </div>
        {event.description && (
          <div className={clsx(taskDetailInspectorStyles['debug-context-box'])}>
            <span>状态</span>
            <strong>{event.description}</strong>
          </div>
        )}
      </div>
    </div>
  )
}

export function LocksTab({
  locks,
  recovery,
}: {
  locks: readonly WorkflowExecutionLockFact[]
  recovery?: WorkflowRecoveryFact
}) {
  const canRelease =
    locks.length > 0 &&
    locks.every((lock) => lock.canRelease === true) &&
    !recovery?.requiresReconciliation
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div
        className={clsx(
          taskDetailInspectorStyles['debug-lock-guard'],
          canRelease ? taskDetailInspectorStyles['is-ready'] : '',
        )}
      >
        <div className={clsx(taskDetailInspectorStyles['debug-lock-guard-head'])}>
          <DebugIcon name={canRelease ? 'unlock' : 'shield-alert'} size={18} />
          <div>
            <strong>{canRelease ? '可释放执行锁' : '当前不可直接释放执行锁'}</strong>
          </div>
        </div>
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-lock-group'])}>
        {locks.length === 0 ? (
          <div
            className={clsx(
              taskDetailInspectorStyles['debug-empty-state'],
              taskDetailInspectorStyles['debug-lock-empty-state'],
            )}
          >
            暂无执行锁快照。
          </div>
        ) : (
          locks.map((lock, index) => (
            <LockRow
              key={`${lock.lockUuid ?? 'lock'}-${index}`}
              title={lock.lockKey ?? lock.lockUuid ?? '未命名锁'}
              scope={lock.scope ?? '未知范围'}
              state={
                lock.state === 'uncertain'
                  ? '状态不明'
                  : lock.canRelease === true
                    ? '可释放'
                    : lock.state
              }
            />
          ))
        )}
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-lock-actions'])}>
        <button
          type="button"
          className={clsx(taskDetailStyles['debug-danger-outline-button'])}
          disabled
        >
          <DebugIcon name="unlock" size={15} /> 人工解除整组锁
        </button>
      </div>
    </div>
  )
}

export function ObservabilityTab({
  feedback,
}: {
  feedback: NodeJobFeedbackPage | null | undefined
}) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-tab-content'])}>
      <div className={clsx(taskDetailInspectorStyles['debug-trace-banner'])}>
        <span className={clsx(taskDetailInspectorStyles['debug-trace-id'])}>Trace / feedback</span>
        <span>{feedback?.items.length ?? 0} 条反馈</span>
      </div>
      <div className={clsx(taskDetailInspectorStyles['debug-observe-section'])}>
        <div className={clsx(taskDetailStyles['debug-detail-section-head'])}>
          <h3>反馈事件</h3>
        </div>
        <div className={clsx(taskDetailInspectorStyles['debug-event-log'])}>
          {feedback?.items.length ? (
            feedback.items.map((item) => (
              <span key={item.feedbackUuid}>
                <b>#{item.sequence}</b>
                <em>{item.feedbackType}</em>
                <small>{item.description ?? JSON.stringify(item.data)}</small>
              </span>
            ))
          ) : (
            <span className={clsx(taskDetailInspectorStyles['debug-event-log-empty'])}>
              <small>暂无反馈事件。</small>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function ResourceRow({
  icon,
  title,
  meta,
  state,
}: {
  icon: string
  title: string
  meta: string
  state: string
}) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-resource-row'])}>
      <span className={clsx(taskDetailInspectorStyles['debug-resource-icon'])}>
        <DebugIcon name={icon} size={16} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{meta}</small>
      </span>
      <em>{state}</em>
    </div>
  )
}
function LockRow({ title, scope, state }: { title: string; scope: string; state: string }) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-lock-row'])}>
      <span>
        <strong>{title}</strong>
        <small>{scope}</small>
      </span>
      <span
        className={clsx(
          state === '可释放'
            ? taskDetailInspectorStyles['lock-ready']
            : state === '状态不明'
              ? taskDetailInspectorStyles['lock-unknown']
              : taskDetailInspectorStyles['lock-held'],
        )}
      >
        <span className={clsx(taskDetailStyles['debug-state-dot'])} />
        {state}
      </span>
    </div>
  )
}
