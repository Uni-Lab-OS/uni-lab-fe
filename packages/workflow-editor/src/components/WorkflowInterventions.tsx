import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { WorkflowButton } from './WorkflowButton'
import { readWorkflowLoadingRequest, type WorkflowRuntimePort } from '@unilab/services'
import { WorkflowLoadingDialog } from './WorkflowLoadingDialog'
import { createWorkflowInterventionController, type InterventionViewState } from '../utils/workflowInterventionController'
import styles from './WorkflowInterventions.module.scss'
import { groupWorkflowLoading, type LoadingDecisionIdentity } from '../utils/workflowLoadingGroups'

/** 全局工作流干预入口：目录/工作流切换不关闭仍待处理的设备异常。 */
export function WorkflowInterventions({ runtime, online = true }: { runtime: WorkflowRuntimePort; online?: boolean }) {
  const controller = useMemo(() => createWorkflowInterventionController(runtime), [runtime])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => controller.start(), [controller])
  useEffect(() => controller.setOnline(online), [controller, online])
  if (!runtime.interventions) return null
  const view = <WorkflowInterventionsView state={state} onMinimize={controller.minimize} onRestore={controller.restore}
    onRetry={() => { void controller.refresh() }} onConfirmLoading={identities => { void controller.confirmLoadingGroup(identities) }} onDecide={(uuid, option) => { void controller.decide(uuid, option) }} />
  return typeof document === 'undefined' ? view : createPortal(view, document.body)
}

export function WorkflowInterventionsView({ state, onMinimize, onRestore, onRetry, onDecide, onConfirmLoading }: {
  state: InterventionViewState
  onMinimize: () => void
  onRestore: () => void
  onRetry: () => void
  onDecide: (uuid: string, option: string) => void
  onConfirmLoading?: (identities: readonly LoadingDecisionIdentity[]) => void
}) {
  const [selectedLoading, setSelectedLoading] = useState<string | null | undefined>(undefined)
  const loadingItems = state.items.filter(item => readWorkflowLoadingRequest(item).kind !== 'absent')
  const groups = groupWorkflowLoading(state.items)
  const activeLoading = selectedLoading === null ? undefined
    : groups.find(group => group.key === selectedLoading) ?? groups[0]
  const groupedCount = groups.reduce((total, group) => total + group.items.length, 0)
  const navigation = loadingItems.length ? <label>待处理事项<select aria-label="待处理事项"
    value={activeLoading?.key ?? ''} onChange={event => setSelectedLoading(event.target.value || null)}>
    <option value="">其他干预与读取信息（{state.items.length - groupedCount}）</option>
    {groups.map(group => <option key={group.key} value={group.key} title={group.taskUuid}>{group.label} · {group.rows.length} 项物料 · 任务 {group.taskUuid.slice(0, 8)}</option>)}
  </select></label> : null
  if (!state.items.length && !state.error) return null
  if (state.minimized) return <aside className={styles.minimized} aria-label="工作流干预小窗">
    <button type="button" onClick={onRestore}>恢复干预窗口（{state.items.length}）</button>
    <span role="status">{state.error ? '连接或读取异常' : '仍有干预等待处理或设备确认'}</span>
  </aside>
  if (activeLoading) {
    const progress = state.loadingProgress && activeLoading.items.some(item => state.loadingProgress!.interventionUuids.includes(item.uuid))
      ? "上次提交：已接受 " + state.loadingProgress.accepted + " / " + state.loadingProgress.total + " 项确认，库存以服务返回为准。" : ''
    const replay = activeLoading.items.find(item => state.replayable?.includes(item.uuid)
      && item.delivery_status === 'unknown')
    const hasUncertain = activeLoading.items.some(item => item.delivery_status === 'unknown')
    const confirm = (onConfirmLoading || activeLoading.items.length === 1)
      && activeLoading.decisions.length && !hasUncertain
      && activeLoading.items.filter(item => item.status === 'open').every(item => item.options.some(option => option.id === 'confirm_loading'))
      ? () => onConfirmLoading
        ? onConfirmLoading(activeLoading.decisions)
        : activeLoading.items.length === 1 && onDecide(activeLoading.items[0]!.uuid, 'confirm_loading')
      : undefined
    return <WorkflowLoadingDialog
      view={{ title: `人工入库 · ${activeLoading.label}`, description: `确认后逐项入库，未成功的项目会保留供核对。${progress}`,
        rows: activeLoading.rows, status: activeLoading.decisions.length ? 'open' : 'selected', deliveryStatus: hasUncertain ? 'unknown' : 'none' }}
      online={!state.offline} busy={state.busy !== null} minimized={false} error={state.error}
      navigation={navigation} onMinimize={onMinimize} onRestore={onRestore} onRefresh={onRetry}
      onConfirm={confirm} onReplay={replay ? () => onDecide(replay.uuid, 'confirm_loading') : undefined} />
  }
  return <section className={styles.dialog} role="dialog" aria-modal="false" aria-label="工作流设备异常干预">
    <header><strong>设备异常与人工干预</strong><button type="button" onClick={onMinimize}>最小化</button></header>
    {navigation}
    {state.error && <div role="alert">{state.error}<button type="button" onClick={onRetry}>重新读取</button></div>}
    {state.items.map(item => <article key={item.uuid}>
      <p>任务 {item.workflow_task_uuid} · 作业 {item.workflow_node_job_uuid}</p>
      <pre>{state.messages[item.uuid] || item.description || '设备尚未提供错误详情，请查看运行输出。'}</pre>
      <p role="status">{item.status === 'open' ? '等待人工选择' : item.delivery_status === 'accepted'
        ? '设备已接受处理方案，等待动作结果' : '方案已选择，等待投递确认'}</p>
      {readWorkflowLoadingRequest(item).kind !== 'absent' && <p role="alert">{readWorkflowLoadingRequest(item).kind === 'invalid' ? '入库明细格式不完整或版本不兼容，请重新读取或更新服务。' : '请从待处理事项选择入库明细，核对后确认。'}</p>}
      <div className={styles.options}>{item.options.filter(() => readWorkflowLoadingRequest(item).kind === 'absent').map(option => <WorkflowButton type="button" key={option.id}
        disabled={state.offline || state.busy !== null || item.status !== 'open'} title={option.description}
        disabledReason={state.offline ? '宿主或事件连接离线，恢复并重新读取后才能提交' : state.busy !== null ? '正在提交干预决定' : '已选择处理方案，等待设备动作结果'}
        onClick={() => onDecide(item.uuid, option.id)}>{option.label || option.description || option.id}</WorkflowButton>)}</div>
      {readWorkflowLoadingRequest(item).kind === 'absent' && item.status === 'selected' && item.delivery_status === 'unknown' && (state.replayable?.includes(item.uuid)
        ? <WorkflowButton type="button" disabled={state.offline || state.busy !== null}
            disabledReason={state.offline ? '连接离线，恢复后才能重投' : '正在提交干预决定'}
            onClick={() => onDecide(item.uuid, item.selected_option_id!)}>重投已选处理</WorkflowButton>
        : <p>处理方案已保存，投递结果尚未确认；服务恢复后将继续处理。</p>)}
    </article>)}
  </section>
}
