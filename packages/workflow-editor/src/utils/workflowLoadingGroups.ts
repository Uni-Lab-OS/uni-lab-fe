import { readWorkflowLoadingRequest, type WorkflowIntervention, type WorkflowLoadingRow } from '@unilab/services'

export interface LoadingDecisionIdentity {
  uuid: string
  revision: number
  requestUuid: string
  requestRevision: number
}
export interface WorkflowLoadingGroup {
  key: string
  taskUuid: string
  label: string
  items: WorkflowIntervention[]
  rows: Array<WorkflowLoadingRow & { confirmationStatus: string }>
  decisions: LoadingDecisionIdentity[]
}

/** 同一任务、同一仓库的已就绪请求共享表格；每条请求仍保留原来的确认边界。 */
export function groupWorkflowLoading(items: readonly WorkflowIntervention[]): WorkflowLoadingGroup[] {
  const groups = new Map<string, WorkflowLoadingGroup>()
  for (const item of items) {
    const projection = readWorkflowLoadingRequest(item)
    if (projection.kind !== 'ready' || !projection.request.rows.length) continue
    const instruments = [...new Set(projection.request.rows.map(row => row.instrument.id))]
    // 一个请求若横跨多个仓库，不拆分其原子确认范围。
    const instrumentKey = instruments.length === 1 ? instruments[0]! : `request:${item.uuid}`
    const key = JSON.stringify([item.workflow_task_uuid, instrumentKey])
    const group = groups.get(key) ?? {
      key, taskUuid: item.workflow_task_uuid,
      label: [...new Set(projection.request.rows.map(row => row.instrument.label))].join('、'),
      items: [], rows: [], decisions: []
    }
    group.items.push(item)
    group.rows.push(...projection.request.rows.map(row => ({
      ...row,
      key: JSON.stringify([item.uuid, row.key]),
      confirmationStatus: item.status === 'open' ? '待确认'
        : item.delivery_status === 'unknown' ? '确认结果待核对' : '已提交，等待库存更新'
    })))
    if (item.status === 'open') group.decisions.push({
      uuid: item.uuid, revision: item.revision,
      requestUuid: projection.request.request_uuid, requestRevision: projection.request.revision
    })
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    group.rows.sort((left, right) => left.site.label.localeCompare(right.site.label, 'zh-CN', { numeric: true })
      || left.site.id.localeCompare(right.site.id) || left.key.localeCompare(right.key))
  }
  return [...groups.values()]
}
