import { useEffect, useMemo, useRef } from 'react'

import {
  workflowTaskControlStatusLabel,
  workflowTaskIsLive,
  workflowTaskStatusLabel,
  workflowTaskToolbarControls,
  workflowTaskVisualStatus
} from '../utils/workflowTaskPresentation'
import type { PersistentWorkflowAuthoringModel } from './persistentWorkflowAuthoringModel'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowDebugControls } from './WorkflowDebugger'

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
 */
export function PersistentWorkflowToolbar({
  model
}: PersistentWorkflowToolbarProps): React.JSX.Element {
  const {
    aggregate,
    busy,
    dirty,
    fullSourceDiff,
    message,
    mode,
    onChooseWorkflow,
    pendingMode,
    policy,
    remoteConflict,
    requestMode,
    runRuntime,
    runtimeBusy,
    saveDraft,
    selectSingleNodeMode,
    setTaskRunMode,
    setTraceViewerOpen,
    singleNodeTargetMissing,
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
  const runningEntryBusy = runtimeBusy || workflowStartBusy
  const liveTask = workflowTaskIsLive(task)
  const compactTaskControls = useMemo(
    () => workflowTaskToolbarControls(task, taskControls),
    [task, taskControls]
  )
  const saveDisabled = Boolean(
    busy ||
    runningEntryBusy ||
    !aggregate ||
    !policy.authoringMutationEnabled ||
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
  const visualStatus = workflowTaskVisualStatus(task)

  return (
    <header className="workflow__toolbar persistent-authoring__toolbar">
      <div className="persistent-authoring__toolbar-navigation">
        {onChooseWorkflow && (
          <WorkflowButton
            type="button"
            className="persistent-authoring__workflow-list"
            disabled={busy || dirty}
            disabledReason={busy
              ? '正在处理工作流，请稍后返回列表'
              : '请先保存当前可写内容'}
            title="返回工作流列表"
            onClick={onChooseWorkflow}
          >
            <ToolbarIcon name="list" />
            <span>工作流列表</span>
          </WorkflowButton>
        )}

        <div
          className="workflow__mode-switch"
          role="group"
          aria-label="工作流单编辑权模式"
        >
          <WorkflowButton
            type="button"
            className={mode === 'code' ? 'is-active' : ''}
            aria-pressed={mode === 'code'}
            disabled={busy}
            disabledReason="正在处理工作流，暂时不能切换编辑模式"
            onClick={() => requestMode('code')}
          >
            代码模式
          </WorkflowButton>
          <WorkflowButton
            type="button"
            className={mode === 'canvas' ? 'is-active' : ''}
            aria-pressed={mode === 'canvas'}
            disabled={busy}
            disabledReason="正在处理工作流，暂时不能切换编辑模式"
            onClick={() => requestMode('canvas')}
          >
            画布模式
          </WorkflowButton>
        </div>
      </div>

      <span
        className="workflow-runtime__message persistent-authoring__toolbar-message"
        role="status"
        aria-live="polite"
        title={message}
      >
        {message}
      </span>

      <div
        className="workflow__toolbar-actions persistent-authoring__debug-toolbar"
        aria-label="工作流调试工具栏"
      >
        {task && (
          <span
            className={`persistent-authoring__task-status is-${visualStatus}`}
            title={`${workflowTaskControlStatusLabel(task)}；任务：${workflowTaskStatusLabel(task.status)}`}
            data-task-status={task.status}
          >
            <i aria-hidden="true" />
            {workflowTaskStatusLabel(task.status)}
          </span>
        )}

        <WorkflowButton
          type="button"
          className={[
            'persistent-authoring__debug-icon',
            dirty ? 'is-dirty' : ''
          ].filter(Boolean).join(' ')}
          aria-label="保存工作流"
          disabled={saveDisabled}
          disabledReason={busy || runningEntryBusy
            ? '正在处理工作流，请稍后保存'
            : !aggregate
              ? '工作流尚未加载完成'
              : !policy.authoringMutationEnabled
                ? '受管精确拓扑由 OS 管理，只能查看'
              : fullSourceDiff || pendingMode || remoteConflict || taskInputForm
                ? '请先完成当前工作流确认操作'
                : '当前工作流不能保存'}
          title="保存工作流（Ctrl+S）"
          onClick={saveDraft}
        >
          <ToolbarIcon name="save" />
        </WorkflowButton>

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
              <ToolbarIcon name={taskRunMode === 'step' ? 'step' : 'debug'} />
              <span aria-hidden="true">⌄</span>
            </summary>
            <div role="menu" aria-label="任务运行模式">
              {(['normal', 'debug', 'step', 'single_node'] as const).map((runMode) => (
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
                  <ToolbarIcon
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
            <ToolbarIcon name="play" />
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
            <ToolbarIcon name="trace" />
          </button>
        )}
      </div>
    </header>
  )
}

function ToolbarIcon({
  name
}: {
  name: 'debug' | 'list' | 'node' | 'play' | 'save' | 'step' | 'trace'
}): React.JSX.Element {
  const paths = {
    debug: <><circle cx="9" cy="10" r="4" /><path d="M9 3v3m0 8v3M3 10h2m8 0h2M4.8 5.8l1.4 1.4m5.6 5.6 1.4 1.4M13.2 5.8l-1.4 1.4M6.2 12.8l-1.4 1.4" /></>,
    list: <><path d="M6 5h9M6 9h9M6 13h9" /><circle cx="3" cy="5" r=".6" /><circle cx="3" cy="9" r=".6" /><circle cx="3" cy="13" r=".6" /></>,
    node: <><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="10" y="10" width="5" height="5" rx="1" /><path d="M8 5.5h3a2 2 0 0 1 2 2V10" /></>,
    play: <path d="m6 4 8 5-8 5Z" />,
    save: <><path d="M3 3h10l2 2v10H3Z" /><path d="M6 3v4h6V3M6 15v-5h6v5" /></>,
    step: <><path d="m4 4 7 5-7 5Z" /><path d="M13 4v10" /></>,
    trace: <><circle cx="4" cy="5" r="1.5" /><circle cx="14" cy="9" r="1.5" /><circle cx="7" cy="14" r="1.5" /><path d="m5.4 5.6 7.1 2.8m.2 1.7-4.4 3M5 6.3l1.4 6.2" /></>
  } satisfies Record<typeof name, React.JSX.Element>

  return (
    <svg
      className="persistent-authoring__toolbar-icon"
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}
