import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { workflowTaskIsLive } from '../utils/workflowTaskPresentation'

const MODE_LABELS = {
  normal: '连续运行',
  step: '单步调试',
  debug: '断点调试',
  single_node: '单节点调试'
} as const

/** 画布调试选择框；与工具栏共用运行模式，只在启动命令中创建真实任务。 */
export function WorkflowCanvasDebugMode({ model, onAutoLayout }: {
  model: PersistentWorkflowAuthoringModel
  onAutoLayout?: () => void
}): React.JSX.Element {
  const disabled = model.busy || !model.aggregate || model.runtimeBusy ||
    model.workflowStartBusy || Boolean(model.taskInputForm) ||
    (workflowTaskIsLive(model.task) && !model.taskHistorical)
  const label = MODE_LABELS[model.taskRunMode]
  return (
    <div className="persistent-authoring__canvas-debug-bar" role="group" aria-label="画布调试设置">
      <select
        className="persistent-authoring__canvas-debug-select"
        aria-label="调试模式"
        value={model.taskRunMode}
        disabled={disabled}
        title={disabled ? '工作流未就绪或正在处理任务，暂时不能切换调试模式' : '选择本次工作流的调试方式'}
        onChange={(event) => {
          const mode = event.currentTarget.value
          if (disabled) return
          if (mode === 'normal' || mode === 'step' ||
            (mode === 'debug' && model.debugLaunchAvailable !== false)) {
            model.setTaskRunMode(mode)
          }
        }}
      >
        <option value="normal">连续运行</option>
        <option value="step">单步调试</option>
        <option value="debug" disabled={model.debugLaunchAvailable === false}>断点调试</option>
        <option value="run-to-node" disabled>运行到选中节点（暂不支持）</option>
        {model.taskRunMode === 'single_node' && <option value="single_node">单节点调试</option>}
      </select>
      <span className="persistent-authoring__canvas-debug-mode" aria-label={`当前调试模式：${label}`}>
        <i aria-hidden="true" />{label}
      </span>
      <button
        type="button"
        className="persistent-authoring__canvas-debug-layout"
        disabled={disabled || !onAutoLayout}
        title="自动排列当前实验操作中的节点"
        onClick={onAutoLayout}
      >
        自动排步
      </button>
    </div>
  )
}
