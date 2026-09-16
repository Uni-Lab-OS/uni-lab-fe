import { readWorkflowLoadingRequest } from '@unilab/services'
import type { WorkflowIntervention, WorkflowRuntimePort } from '@unilab/services'
import type { LoadingDecisionIdentity } from './workflowLoadingGroups'

export interface InterventionViewState {
  items: WorkflowIntervention[]
  minimized: boolean
  busy: string | null
  error: string | null
  messages: Record<string, string>
  offline?: boolean
  replayable?: string[]
  loadingProgress?: { accepted: number; total: number; interventionUuids: string[] }
}

/** 保存服务端投影与展示偏好；任何响应缺失、断网或决定接受均不关闭干预。 */
export function createWorkflowInterventionController(runtime: WorkflowRuntimePort) {
  let state: InterventionViewState = { items: [], minimized: false, busy: null, error: null, messages: {} }
  const listeners = new Set<() => void>()
  const keys = new Map<string, string>()
  const decisionErrors = new Map<string, string>()
  const payloads = new Map<string, { revision: number; option_id: string; result?: { request_uuid: string; revision: number } }>()
  let batch = false
  let disposed = false
  let hostOnline = true
  let eventsOnline = true
  let pendingRefresh: Promise<void> | undefined
  let refreshAgain = false
  const update = (patch: Partial<InterventionViewState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    state.replayable = state.items.filter(item => item.status === 'selected' && item.delivery_status === 'unknown'
      && item.selected_option_id && keys.has(`${item.uuid}:${item.revision}:${item.selected_option_id}`)).map(item => item.uuid)
    for (const listener of listeners) listener()
  }
  const readProjection = async (): Promise<void> => {
    if (!runtime.interventions || disposed || !hostOnline) return
    try {
      do {
        refreshAgain = false
        const [open, selected] = await Promise.all([
          runtime.interventions.list('open'), runtime.interventions.list('selected')
        ])
        const found = new Map([...open, ...selected].map(item => [item.uuid, item]))
        // 列表不是关闭凭据；逐条读取消失项，只有权威 superseded 才移除。
        for (const previous of state.items) {
          if (!found.has(previous.uuid)) found.set(previous.uuid, await runtime.interventions.get(previous.uuid))
        }
        const items = [...found.values()].filter(item => item.status !== 'superseded')
        for (const uuid of decisionErrors.keys()) {
          if (!items.some(item => item.uuid === uuid)) decisionErrors.delete(uuid)
        }
        const messages = { ...state.messages }
        let detailError: string | null = null
        await Promise.all(items.map(async item => {
          if (item.description) { messages[item.uuid] = item.description; return }
          if (readWorkflowLoadingRequest(item).kind !== 'absent') { messages[item.uuid] = '请核对入库明细。'; return }
          const report = item.meta_data.error_report
          if (report && typeof report === 'object' && 'error_message' in report && typeof report.error_message === 'string') {
            messages[item.uuid] = report.error_message
            return
          }
          try {
            const job = await runtime.getWorkflowNodeJob(item.workflow_node_job_uuid)
            messages[item.uuid] = job.error_info.map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n')
          } catch (error) { detailError = errorMessage(error) }
        }))
        if (!hostOnline) return
        update({ items, messages, offline: !eventsOnline, error: combineErrors(
          !eventsOnline ? '事件连接离线，等待重连。' : detailError,
          ...decisionErrors.values(),
          open.length === 500 || selected.length === 500
            ? '干预列表达到服务端查询上限，可能还有未展示项目；请先处理当前干预。' : null
        ) })
      } while (refreshAgain && !disposed)
    } catch (error) { update({ error: combineErrors(errorMessage(error), ...decisionErrors.values()), offline: true }) }
  }
  const refresh = (): Promise<void> => {
    if (pendingRefresh) { refreshAgain = true; return pendingRefresh }
    pendingRefresh = readProjection().finally(() => { pendingRefresh = undefined })
    return pendingRefresh
  }
  const decide = async (uuid: string, optionId: string, inBatch = false) => {
    const item = state.items.find(candidate => candidate.uuid === uuid)
    if (disposed || !hostOnline || !item || !runtime.interventions || (state.busy && !inBatch) || (batch && !inBatch) || state.offline) return
    const identity = `${uuid}:${item.revision}:${optionId}`
    const replay = item.status === 'selected' && item.delivery_status === 'unknown'
      && item.selected_option_id === optionId && keys.has(identity)
    if (item.status !== 'open' && !replay) return
    const loading = readWorkflowLoadingRequest(item)
    if (!replay && loading.kind !== 'absent') {
      if (loading.kind === 'invalid') { update({ error: loading.message }); return }
      if (optionId !== 'confirm_loading' || !item.options.some(option => option.id === optionId) ||
        !loading.request.rows.length || loading.request.rows.some(row => !row.availability.allowed)) {
        update({ error: '当前入库明细不可确认，请重新读取。' }); return
      }
    }
    const body = payloads.get(identity) ?? {
      revision: item.revision, option_id: optionId,
      ...(loading.kind === 'ready' ? { result: { request_uuid: loading.request.request_uuid, revision: loading.request.revision } } : {})
    }
    payloads.set(identity, body)
    const key = keys.get(identity) ?? globalThis.crypto.randomUUID()
    keys.set(identity, key)
    decisionErrors.delete(uuid)
    update({ busy: uuid, error: combineErrors(...decisionErrors.values()) })
    try {
      const response = await runtime.interventions.decide(uuid, body, key)
      update({ items: state.items.map(previous => previous.uuid === uuid ? response.intervention : previous) })
      await refresh()
      const current = state.items.find(value => value.uuid === uuid)
      return !state.offline && (!current || current.status === 'superseded' || current.delivery_status === 'accepted')
    } catch (error) {
      // 请求结果不确定时先重读；不乐观恢复 open，也不把 HTTP 接受当作完成。
      decisionErrors.set(uuid, errorMessage(error))
      await refresh()
      if (!hostOnline) update({ error: combineErrors(state.error, ...decisionErrors.values()) })
    } finally { update({ busy: batch ? 'loading-group' : null }) }
  }
  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    minimize: () => update({ minimized: true }),
    restore: () => update({ minimized: false }),
    setOnline: (online: boolean) => {
      if (!runtime.interventions) return
      hostOnline = online
      if (!online) update({ offline: true, error: '工作区宿主离线；保留未决干预，恢复连接后重新读取。' })
      if (online) void refresh()
    },
    refresh,
    start: () => {
      disposed = false
      if (!runtime.interventions) return () => {}
      const subscription = runtime.subscribeWorkflowRuntime(event => {
        if (event.event === 'workflow.runtime.changed') void refresh()
      }, { onOpen: () => { eventsOnline = true; if (hostOnline) void refresh() },
        onError: error => { eventsOnline = false; update({ offline: true, error: errorMessage(error) }) } })
      void refresh()
      return () => { disposed = true; subscription.dispose() }
    },
    decide,
    confirmLoadingGroup: async (identities: readonly LoadingDecisionIdentity[]) => {
      if (disposed || !hostOnline || batch || state.busy || state.offline || !identities.length) return
      for (const identity of identities) {
        const item = state.items.find(candidate => candidate.uuid === identity.uuid)
        const loading = item && readWorkflowLoadingRequest(item)
        if (!item || item.status !== 'open' || item.revision !== identity.revision || loading?.kind !== 'ready'
          || loading.request.request_uuid !== identity.requestUuid || loading.request.revision !== identity.requestRevision) {
          update({ error: '入库明细已变化，请重新核对后确认。' })
          return
        }
      }
      batch = true
      const interventionUuids = identities.map(identity => identity.uuid)
      update({ busy: 'loading-group', loadingProgress: { accepted: 0, total: identities.length, interventionUuids } })
      try {
        let accepted = 0
        for (const identity of identities) {
          if (disposed || !hostOnline || state.offline) break
          const current = state.items.find(item => item.uuid === identity.uuid)
          const loading = current && readWorkflowLoadingRequest(current)
          if (!current || current.status !== 'open' || current.revision !== identity.revision
            || loading?.kind !== 'ready' || loading.request.request_uuid !== identity.requestUuid
            || loading.request.revision !== identity.requestRevision) {
            update({ error: '入库明细已变化；已接受的确认保留，请重新核对其余项目。' })
            break
          }
          if (!await decide(identity.uuid, 'confirm_loading', true)) break
          accepted += 1
          update({ loadingProgress: { accepted, total: identities.length, interventionUuids } })
        }
      } finally { batch = false; update({ busy: null }) }

    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 重连可以清除连接错误，但不能自行清除未解决的决定错误。 */
function combineErrors(...messages: Array<string | null>): string | null {
  const values = [...new Set(messages.filter((message): message is string => Boolean(message)))]
  return values.length ? values.join('\n') : null
}
