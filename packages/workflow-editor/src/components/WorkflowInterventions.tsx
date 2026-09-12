import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { WorkflowButton } from './WorkflowButton'
import type { WorkflowRuntimePort } from '@unilab/services'
import { createWorkflowInterventionController, type InterventionViewState } from '../utils/workflowInterventionController'
import styles from './WorkflowInterventions.module.scss'

/** 全局工作流干预入口：目录/工作流切换不关闭仍待处理的设备异常。 */
export function WorkflowInterventions({ runtime, online = true }: { runtime: WorkflowRuntimePort; online?: boolean }) {
  const controller = useMemo(() => createWorkflowInterventionController(runtime), [runtime])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useEffect(() => controller.start(), [controller])
  useEffect(() => controller.setOnline(online), [controller, online])
  if (!runtime.interventions) return null
  const view = <WorkflowInterventionsView state={state} onMinimize={controller.minimize} onRestore={controller.restore}
    onRetry={() => { void controller.refresh() }} onDecide={(uuid, option) => { void controller.decide(uuid, option) }} />
  return typeof document === 'undefined' ? view : createPortal(view, document.body)
}

export function WorkflowInterventionsView({ state, onMinimize, onRestore, onRetry, onDecide }: {
  state: InterventionViewState
  onMinimize: () => void
  onRestore: () => void
  onRetry: () => void
  onDecide: (uuid: string, option: string) => void
}) {
  if (!state.items.length && !state.error) return null
  if (state.minimized) return <aside className={styles.minimized} aria-label="工作流干预小窗">
    <button type="button" onClick={onRestore}>恢复干预窗口（{state.items.length}）</button>
    <span role="status">{state.error ? '连接或读取异常' : '仍有干预等待处理或设备确认'}</span>
  </aside>
  return <section className={styles.dialog} role="dialog" aria-modal="false" aria-label="工作流设备异常干预">
    <header><strong>设备异常与人工干预</strong><button type="button" onClick={onMinimize}>最小化</button></header>
    {state.error && <div role="alert">{state.error}<button type="button" onClick={onRetry}>重新读取</button></div>}
    {state.items.map(item => <article key={item.uuid}>
      <p>任务 {item.workflow_task_uuid} · 作业 {item.workflow_node_job_uuid}</p>
      <pre>{state.messages[item.uuid] || item.description || '设备尚未提供错误详情，请查看运行输出。'}</pre>
      <p role="status">{item.status === 'open' ? '等待人工选择' : item.delivery_status === 'accepted'
        ? '设备已接受处理方案，等待动作结果' : '方案已选择，等待投递确认'}</p>
      <div className={styles.options}>{item.options.map(option => <WorkflowButton type="button" key={option.id}
        disabled={state.offline || state.busy !== null || item.status !== 'open'} title={option.description}
        disabledReason={state.offline ? '宿主或事件连接离线，恢复并重新读取后才能提交' : state.busy !== null ? '正在提交干预决定' : '已选择处理方案，等待设备动作结果'}
        onClick={() => onDecide(item.uuid, option.id)}>{option.label || option.description || option.id}</WorkflowButton>)}</div>
      {item.status === 'selected' && item.delivery_status === 'unknown' && (state.replayable?.includes(item.uuid)
        ? <WorkflowButton type="button" disabled={state.offline || state.busy !== null}
            disabledReason={state.offline ? '连接离线，恢复后才能重投' : '正在提交干预决定'}
            onClick={() => onDecide(item.uuid, item.selected_option_id!)}>重投已选处理</WorkflowButton>
        : <p>处理方案已保存，投递结果尚未确认；服务恢复后将继续处理。</p>)}
    </article>)}
  </section>
}
