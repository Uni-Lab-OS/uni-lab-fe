import { clsx } from 'clsx'
import type { WorkflowNodeJobDetail, WorkflowResourceWaitFact } from '@unilab-fe/core'
import taskDetailInspectorStyles from './TaskDetailInspector.module.scss'
import { DebugIcon } from './TaskDetailIcons'
import { hasWorkflowSiteFact, readExpectedChangeSetKind } from './taskDetailModel'

export function ResourcesTab({
  waits,
  job,
}: {
  waits: readonly WorkflowResourceWaitFact[]
  job: WorkflowNodeJobDetail | null
}) {
  const actualExecutor = asRecord(job?.controlData.actual_executor)
  const dispatchPayload = asRecord(job?.controlData.dispatch_payload)
  const materialUuid = stringValue(actualExecutor?.material_uuid)
  const deviceId =
    stringValue(actualExecutor?.local_device_id) ?? stringValue(dispatchPayload?.device_id)
  const noInventoryChange = readExpectedChangeSetKind(job) === 'no_inventory_change'
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

function ResourceRow({ title, meta, state }: { title: string; meta: string; state: string }) {
  return (
    <div className={clsx(taskDetailInspectorStyles['debug-resource-row'])}>
      <span className={clsx(taskDetailInspectorStyles['debug-resource-icon'])}>
        <DebugIcon name="cube" size={16} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{meta}</small>
      </span>
      <em>{state}</em>
    </div>
  )
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}
