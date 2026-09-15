import { useEffect } from 'react'

import { WorkflowButton } from './WorkflowButton'
import { WorkflowDebugControls } from './WorkflowDebugger'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import {
  workflowTaskIsLive,
  workflowTaskStatusLabel,
  workflowTaskToolbarControls,
  workflowTaskVisualStatus
} from '../utils/workflowTaskPresentation'

const RUN_MODES = {
  normal: '全流程运行',
  debug: '断点调试',
  step: '单步调试',
  single_node: '单节点调试'
} as const

/** 调试画布的两行工具栏；保存、校验和运行均委托给现有编写模型。 */
export function WorkflowDebugToolbar({
  model,
  workflowName,
  structureOpen,
  onToggleStructure,
  onToggleLibrary,
  compact,
  onAutoLayout,
  onZoomIn,
  onZoomOut,
  onConfigureIo
}: {
  model: PersistentWorkflowAuthoringModel
  workflowName?: string
  structureOpen: boolean
  onToggleStructure(): void
  onToggleLibrary(): void
  compact: boolean
  onAutoLayout?(): void
  onZoomIn(): void
  onZoomOut(): void
  onConfigureIo(): void
}): React.JSX.Element {
  const {
    aggregate, busy, runtimeBusy, workflowStartBusy, dirty, ideSourceDirty,
    mode, fullSourceDiff, pendingMode, remoteConflict, taskInputForm,
    task, taskHistorical, taskControls, taskRunMode, taskRuntime,
    workflowStartPresentation, singleNodeTargetMissing
  } = model
  const working = busy || runtimeBusy || workflowStartBusy
  const live = workflowTaskIsLive(task) && !taskHistorical
  const saveDirty = mode === 'code' ? dirty || ideSourceDirty : dirty
  const pendingConfirmation = Boolean(fullSourceDiff || pendingMode || remoteConflict || taskInputForm)
  const saveDisabled = !saveDirty || working || !aggregate || pendingConfirmation ||
    model.definitionEditingAvailable === false
  const publishDisabled = !aggregate?.candidate || dirty || ideSourceDirty || working ||
    pendingConfirmation || model.definitionEditingAvailable === false
  const startDisabled = working || !aggregate || singleNodeTargetMissing || workflowStartPresentation.disabled

  useEffect(() => {
    const save = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 's' || (!event.metaKey && !event.ctrlKey) || saveDisabled) return
      event.preventDefault()
      model.saveDraft()
    }
    document.addEventListener('keydown', save)
    return () => document.removeEventListener('keydown', save)
  }, [model.saveDraft, saveDisabled])

  return <div className="workflow-debug-toolbar">
    <header className="workflow-debug-toolbar__main">
      <div className="workflow-debug-toolbar__identity">
        <strong title={workflowName}>{workflowName || '当前工作流'}</strong>
        {(!aggregate || saveDirty) && <small>{aggregate ? '未保存' : '正在读取…'}</small>}
      </div>
      <div className="workflow-debug-toolbar__actions" aria-label="工作流画布工具">
        {compact && <button type="button" onClick={onToggleLibrary}>工作流库</button>}
        <button type="button" aria-pressed={structureOpen} onClick={onToggleStructure}>{structureOpen ? '隐藏流程' : '显示流程'}</button>
        <WorkflowButton type="button" disabled={saveDisabled} disabledReason={working ? '正在处理工作流，请稍候' : pendingConfirmation ? '请先完成当前确认操作' : '没有可保存的修改'} onClick={model.saveDraft} aria-label="保存" aria-busy={model.preparingSavePreview || undefined} style={{ minWidth: 64 }}>{model.preparingSavePreview ? '生成中…' : '保存'}</WorkflowButton>
        <WorkflowButton type="button" className="is-primary" disabled={publishDisabled} disabledReason={dirty || ideSourceDirty ? '请先保存当前修改' : '当前没有可发布的修改，或正在处理工作流'} onClick={model.applyCandidate}>发布</WorkflowButton>
        <WorkflowButton type="button" disabled={working || !aggregate || model.codeViewingAvailable === false} disabledReason="当前暂时无法切换源码视图" onClick={() => model.requestMode(mode === 'canvas' ? 'code' : 'canvas')}>{mode === 'canvas' ? '查看源码' : '查看画布'}</WorkflowButton>
        <WorkflowButton type="button" disabled={working || !aggregate || !model.canvasValidationAvailable} disabledReason="当前画布尚未就绪或不支持校验" onClick={model.validateCanvasDraft}>✓ 校验</WorkflowButton>
        <button type="button" onClick={onAutoLayout} disabled={!onAutoLayout} title="使用 ELK 横向排列当前画布预览">自动排列</button>
        <button type="button" aria-label="缩小画布" onClick={onZoomOut}>−</button>
        <button type="button" aria-label="放大画布" onClick={onZoomIn}>＋</button>
        {!live && <WorkflowButton type="button" className="is-primary is-run" disabled={startDisabled} disabledReason={working ? '正在处理工作流，请稍候' : singleNodeTargetMissing ? '请先设置调试起始节点' : workflowStartPresentation.disabledReason ?? '工作流尚未就绪'} onClick={model.startWorkflow}>▶ {workflowStartBusy ? '准备中…' : '运行调试'}</WorkflowButton>}
      </div>
    </header>
    <div className="workflow-debug-toolbar__controls">
      <select aria-label="工作流运行模式" value={taskRunMode} disabled={working || live || !aggregate || Boolean(taskInputForm)} onChange={(event) => {
        const value = event.target.value as keyof typeof RUN_MODES
        if (value === 'single_node') model.selectSingleNodeMode()
        else model.setTaskRunMode(value)
      }}>
        {Object.entries(RUN_MODES).filter(([value]) => value !== 'debug' || model.debugLaunchAvailable !== false).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <span className="workflow-debug-toolbar__clock">实时</span>
      <span className={`workflow-debug-toolbar__status is-${task && !taskHistorical ? workflowTaskVisualStatus(task) : 'idle'}`} role="status">
        <i aria-hidden="true" />{taskHistorical ? '历史记录' : task ? workflowTaskStatusLabel(task.status) : '未开始'}
      </span>
      <div className="workflow-debug-toolbar__runtime-actions">
        {live && !taskRuntime.snapshot.debug && <WorkflowDebugControls compact controls={workflowTaskToolbarControls(task, taskControls)} actionGroupLabel="任务执行控制" dangerGroupLabel="任务取消控制" commandDataAttribute="runtime" onCommand={(command) => model.runRuntime(() => taskRuntime.command(command))} />}
        <WorkflowButton type="button" disabled={!model.graph} disabledReason="工作流图尚未加载完成" onClick={onConfigureIo}>输入 / 输出</WorkflowButton>
        <button type="button" aria-expanded={model.outputExpanded} onClick={() => model.setOutputExpanded(!model.outputExpanded)}>运行结果</button>
      </div>
    </div>
    <div className="workflow-debug-toolbar__message" role="status">{model.message !== '源码与工作流已同步' ? model.message : null}</div>
  </div>
}
