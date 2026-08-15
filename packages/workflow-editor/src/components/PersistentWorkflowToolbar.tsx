import { useEffect, useMemo, useRef } from 'react'

import {
  workflowTaskIsLive,
  workflowTaskToolbarControls
} from '../utils/workflowTaskPresentation'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowDebugControls } from './WorkflowDebugger'
import {
  WorkflowToolbarIcon,
  WorkflowWorkspaceToolbar
} from './WorkflowWorkspaceToolbar'

interface PersistentWorkflowToolbarProps {
  model: PersistentWorkflowAuthoringModel
}

const RUN_MODE_LABELS = {
  normal: '正常运行',
  step: '单步模式',
  single_node: '单节点调试',
  debug: '调试启动'
} as const

/**
 * 单行工作流调试工具栏。编辑模式、保存与任务控制共享同一状态入口。
 *
 * @param props 当前工作流定义权威来源的统一编写模型。
 * @returns 根据加载、编辑和任务状态统一约束的工具栏。
 */
export function PersistentWorkflowToolbar({
  model
}: PersistentWorkflowToolbarProps): React.JSX.Element {
  const {
    aggregate,
    authorityLabel,
    busy,
    debugLaunchAvailable,
    definitionEditingAvailable,
    definitionEditingDisabledReason,
    dirty,
    fullSourceDiff,
    message,
    mode,
    onChooseWorkflow,
    pendingMode,
    remoteConflict,
    requestMode,
    runRuntime,
    runtimeBusy,
    saveDraft,
    selectSingleNodeMode,
    setTaskRunMode,
    setTraceViewerOpen,
    singleNodeTargetMissing,
    sourceEditingAvailable,
    sourceEditingDisabledReason,
    startWorkflow,
    task,
    taskControls,
    taskInputForm,
    taskRunMode,
    taskRuntime,
    traceRuntime,
    workflowStartBusy,
    workflowStartPresentation
  } = model
  const runModeMenuRef = useRef<HTMLDetailsElement | null>(null)
  const currentAuthorityLabel = authorityLabel ?? 'OS'
  const canEditDefinition = definitionEditingAvailable !== false
  const canEditSource = sourceEditingAvailable !== false
  const canDebugLaunch = debugLaunchAvailable !== false
  const runningEntryBusy = runtimeBusy || workflowStartBusy
  const modeSwitchDisabled = busy || !aggregate
  const modeSwitchDisabledReason = busy
    ? '正在读取或处理工作流，请稍后切换编辑模式'
    : '工作流尚未加载完成'
  const liveTask = workflowTaskIsLive(task)
  const compactTaskControls = useMemo(
    () => workflowTaskToolbarControls(task, taskControls),
    [task, taskControls]
  )
  const saveDisabled = Boolean(
    !dirty ||
    !canEditDefinition ||
    busy ||
    runningEntryBusy ||
    !aggregate ||
    fullSourceDiff ||
    pendingMode ||
    remoteConflict ||
    taskInputForm
  )

  useEffect(() => {
    /** Ctrl/Cmd+S 始终委托给同一个工作流草稿保存命令。 */
    const handleSaveShortcut = (event: KeyboardEvent): void => {
      if (
        event.key.toLowerCase() !== 's' ||
        (!event.ctrlKey && !event.metaKey) ||
        saveDisabled
      ) return
      event.preventDefault()
      saveDraft()
    }
    document.addEventListener('keydown', handleSaveShortcut)
    return () => document.removeEventListener('keydown', handleSaveShortcut)
  }, [saveDisabled, saveDraft])

  const chooseRunMode = (runMode: typeof taskRunMode): void => {
    runModeMenuRef.current?.removeAttribute('open')
    if (runMode === 'single_node') {
      selectSingleNodeMode()
      return
    }
    setTaskRunMode(runMode)
  }

  const startLabel = taskRunMode === 'single_node'
    ? '开始单节点调试'
    : taskRunMode === 'debug'
      ? '调试启动'
    : workflowStartPresentation.label
  return (
    <WorkflowWorkspaceToolbar
      task={task}
      message={message}
      onChooseWorkflow={onChooseWorkflow}
      navigationDisabled={busy || dirty}
      navigationDisabledReason={busy
        ? '正在处理工作流，请稍后返回列表'
        : '请先保存当前可写内容'}
      codeMode={{
        active: mode === 'code',
        disabled: modeSwitchDisabled || !canEditSource,
        disabledReason: !canEditSource
          ? sourceEditingDisabledReason ?? '当前数据源不支持代码模式'
          : modeSwitchDisabledReason,
        onSelect: () => requestMode('code')
      }}
      canvasMode={{
        active: mode === 'canvas',
        disabled: modeSwitchDisabled,
        disabledReason: modeSwitchDisabledReason,
        onSelect: () => requestMode('canvas')
      }}
      save={{
        dirty,
        disabled: saveDisabled,
        disabledReason: busy || runningEntryBusy
          ? '正在处理工作流，请稍后保存'
          : !canEditDefinition
            ? definitionEditingDisabledReason ??
              `${currentAuthorityLabel} 未提供工作流定义写能力`
          : !aggregate
            ? '工作流尚未加载完成'
            : !dirty
              ? `${currentAuthorityLabel} 画布没有待保存修改`
            : fullSourceDiff || pendingMode || remoteConflict || taskInputForm
              ? '请先完成当前工作流确认操作'
              : '当前工作流不能保存',
        title: '保存工作流（Ctrl+S）',
        onSave: saveDraft
      }}
    >
        {!liveTask && (
          <details
            ref={runModeMenuRef}
            className="persistent-authoring__run-mode-menu"
          >
            <summary
              aria-label={`选择运行模式，当前为${RUN_MODE_LABELS[taskRunMode]}`}
              aria-disabled={runningEntryBusy}
              title={`运行模式：${RUN_MODE_LABELS[taskRunMode]}`}
              onClick={(event) => {
                if (runningEntryBusy) event.preventDefault()
              }}
            >
              <WorkflowToolbarIcon
                name={taskRunMode === 'step' ? 'step' : 'debug'}
              />
              <span aria-hidden="true">⌄</span>
            </summary>
            <div role="menu" aria-label="任务运行模式">
              {(['normal', 'debug', 'step', 'single_node'] as const)
                .filter((runMode) => runMode !== 'debug' || canDebugLaunch)
                .map((runMode) => (
                <WorkflowButton
                  key={runMode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={taskRunMode === runMode}
                  className={taskRunMode === runMode ? 'is-active' : ''}
                  disabled={runningEntryBusy}
                  disabledReason="正在处理工作流任务，暂时不能切换运行模式"
                  onClick={() => chooseRunMode(runMode)}
                >
                  <WorkflowToolbarIcon
                    name={runMode === 'normal'
                      ? 'play'
                      : runMode === 'debug'
                        ? 'debug'
                      : runMode === 'step'
                        ? 'step'
                        : 'node'}
                  />
                  <span>{RUN_MODE_LABELS[runMode]}</span>
                  {taskRunMode === runMode && <i aria-hidden="true">✓</i>}
                </WorkflowButton>
              ))}
            </div>
          </details>
        )}

        {!liveTask && (
          <WorkflowButton
            type="button"
            className="persistent-authoring__debug-icon is-start"
            aria-label={startLabel}
            disabled={
              busy ||
              runningEntryBusy ||
              singleNodeTargetMissing ||
              workflowStartPresentation.disabled
            }
            disabledReason={busy
              ? '正在处理工作流编写操作，请稍候'
              : runningEntryBusy
                ? '正在处理上一项工作流任务操作，请稍候'
                : singleNodeTargetMissing
                  ? '请先在画布节点上设置起始点'
                  : workflowStartPresentation.disabledReason ??
                    '工作流尚未就绪'}
            title={`${startLabel} · ${RUN_MODE_LABELS[taskRunMode]}`}
            onClick={startWorkflow}
          >
            <WorkflowToolbarIcon name="play" />
          </WorkflowButton>
        )}

        {liveTask && !taskRuntime.snapshot.debug && (
          <WorkflowDebugControls
            compact
            controls={compactTaskControls}
            actionGroupLabel="任务执行控制"
            dangerGroupLabel="任务取消控制"
            commandDataAttribute="runtime"
            onCommand={(command) => runRuntime(
              () => taskRuntime.command(command)
            )}
          />
        )}

        {traceRuntime && (
          <button
            type="button"
            className="persistent-authoring__debug-icon"
            aria-label="查看工作流 Trace"
            title="查看 Electron 与 Uni-Lab-OS 上报的运行 Trace"
            onClick={() => setTraceViewerOpen(true)}
          >
            <WorkflowToolbarIcon name="trace" />
          </button>
        )}
    </WorkflowWorkspaceToolbar>
  )
}
