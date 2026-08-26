import { useDismissibleDetails } from '@unilab/design-system/hooks'
import { useEffect, useMemo } from 'react'

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
  hideRuntimeControls?: boolean
  onResetEnvironment?: () => Promise<void>
  environmentResetBusy?: boolean
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
 * @throws 不主动抛错；工作流命令异常由上层编写模型处理。
 * @safety 仅通过注入命令修改工作流；菜单关闭不改变运行模式。
 */
export function PersistentWorkflowToolbar({
  model,
  hideRuntimeControls = false,
  onResetEnvironment,
  environmentResetBusy = false
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
    ideSourceDirty,
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
    codeViewingAvailable,
    sourceEditingAvailable,
    sourceEditingDisabledReason,
    startWorkflow,
    task,
    taskHistorical,
    taskControls,
    taskInputForm,
    taskRunMode,
    taskRuntime,
    traceRuntime,
    workflowStartBusy,
    workflowStartPresentation
  } = model
  const runModeMenuRef = useDismissibleDetails()
  const currentAuthorityLabel = authorityLabel ?? 'OS'
  const canEditDefinition = definitionEditingAvailable !== false
  const canViewCode = codeViewingAvailable !== false
  const canEditSource = sourceEditingAvailable !== false
  const canDebugLaunch = debugLaunchAvailable !== false
  const runningEntryBusy = runtimeBusy || workflowStartBusy
  const modeSwitchDisabled = busy || !aggregate
  const modeSwitchDisabledReason = busy
    ? '正在读取或处理工作流，请稍后切换编辑模式'
    : '工作流尚未加载完成'
  const liveTask = workflowTaskIsLive(task) && !taskHistorical
  const saveDirty = mode === 'code' ? ideSourceDirty || dirty : dirty
  const compactTaskControls = useMemo(
    () => workflowTaskToolbarControls(taskHistorical ? null : task, taskControls),
    [task, taskControls, taskHistorical]
  )
  const saveDisabled = Boolean(
    !saveDirty ||
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

  const initialStartLabel = taskRunMode === 'single_node'
    ? '开始单节点调试'
    : taskRunMode === 'debug'
      ? '调试启动'
      : workflowStartPresentation.label
  const startLabel = liveTask
    ? taskRunMode === 'single_node'
      ? '再次单节点调试'
      : taskRunMode === 'debug'
        ? '再次调试启动'
        : taskRunMode === 'step'
          ? '再次单步运行'
          : '再次运行'
    : initialStartLabel
  return (
    <WorkflowWorkspaceToolbar
      task={task}
      historicalTask={taskHistorical}
      message={message}
      onChooseWorkflow={onChooseWorkflow}
      navigationDisabled={busy || dirty}
      navigationDisabledReason={busy
        ? '正在处理工作流，请稍后返回列表'
        : '请先保存当前可写内容'}
      codeMode={{
        active: mode === 'code',
        disabled: modeSwitchDisabled || !canViewCode,
        visible: canViewCode,
        disabledReason: !canViewCode
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
        dirty: saveDirty,
        disabled: saveDisabled,
        disabledReason: busy || runningEntryBusy
          ? '正在处理工作流，请稍后保存'
          : !canEditDefinition
            ? definitionEditingDisabledReason ??
              `${currentAuthorityLabel} 未提供工作流定义写能力`
          : !aggregate
            ? '工作流尚未加载完成'
            : !saveDirty
              ? mode === 'code' && !canEditSource
                ? `${currentAuthorityLabel} 代码视图为只读；请切回画布模式修改`
                : `${currentAuthorityLabel} 画布没有待保存修改`
            : fullSourceDiff || pendingMode || remoteConflict || taskInputForm
              ? '请先完成当前工作流确认操作'
              : '当前工作流不能保存',
        title: '保存工作流（Ctrl+S）',
        onSave: saveDraft
      }}
      hideActions={hideRuntimeControls}
    >
        <details
          ref={runModeMenuRef}
          className="persistent-authoring__run-mode-menu"
        >
          <summary
            aria-label={`运行设置，当前为${RUN_MODE_LABELS[taskRunMode]}`}
            aria-disabled={runningEntryBusy}
            title={`运行设置：${RUN_MODE_LABELS[taskRunMode]}`}
            onClick={(event) => {
              if (runningEntryBusy) event.preventDefault()
            }}
          >
            <WorkflowToolbarIcon
              name={taskRunMode === 'step' ? 'step' : 'debug'}
            />
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

        <WorkflowButton
          type="button"
          className="persistent-authoring__debug-icon is-start"
          aria-label={startLabel}
          disabled={
            busy ||
            runningEntryBusy ||
            environmentResetBusy ||
            singleNodeTargetMissing ||
            workflowStartPresentation.disabled
          }
          disabledReason={busy
            ? '正在处理工作流编写操作，请稍候'
            : environmentResetBusy
              ? '运行前环境正在复位，请等待安全校验完成'
              : runningEntryBusy
                ? '正在处理上一项工作流任务操作，请稍候'
                : singleNodeTargetMissing
                  ? '请先在画布节点上设置起始点'
                  : workflowStartPresentation.disabledReason ??
                    '工作流尚未就绪'}
          title={liveTask
            ? `${startLabel} · 创建新的独立工作流任务；当前任务继续运行，资源冲突由调度器排队`
            : `${startLabel} · ${RUN_MODE_LABELS[taskRunMode]}`}
          data-tooltip={liveTask
            ? `${startLabel}：创建新的独立任务`
            : undefined}
          onClick={startWorkflow}
        >
          <WorkflowToolbarIcon name="play" />
        </WorkflowButton>

        <WorkflowButton
          type="button"
          className="persistent-authoring__debug-icon"
          aria-label="复位运行环境"
          disabled={
            !onResetEnvironment ||
            busy ||
            runningEntryBusy ||
            liveTask ||
            environmentResetBusy ||
            dirty
          }
          disabledReason={!onResetEnvironment
            ? '当前宿主不支持复位运行环境'
            : liveTask
              ? '工作流运行期间不能复位环境'
              : environmentResetBusy || runningEntryBusy
                ? '正在处理运行环境，请稍候'
                : dirty
                  ? '请先保存当前工作流修改'
                  : busy
                    ? '正在处理工作流编写操作，请稍候'
                    : '当前运行环境暂时不能复位'}
          title={environmentResetBusy
            ? '正在复位运行环境'
            : '复位 PLC 与 Backend 物料状态'}
          onClick={() => {
            if (!onResetEnvironment || !globalThis.confirm(
              '确定复位运行环境吗？\n\n将重启 PLC-Sim，并使用当前设备图清空并重建 Backend 物料与库位状态。'
            )) return
            void onResetEnvironment()
          }}
        >
          <WorkflowToolbarIcon name="refresh" />
        </WorkflowButton>

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
