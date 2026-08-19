import type { ReactNode } from 'react'

import type { WorkflowTask } from '@unilab/services'

import {
  workflowTaskControlStatusLabel,
  workflowTaskIsLive,
  workflowTaskStatusLabel,
  workflowTaskVisualStatus
} from '../utils/workflowTaskPresentation'
import { WorkflowButton } from './WorkflowButton'

export interface WorkflowWorkspaceModeControl {
  active: boolean
  disabled: boolean
  disabledReason: string
  visible?: boolean
  onSelect?: () => void
}

export interface WorkflowWorkspaceSaveControl {
  dirty?: boolean
  disabled: boolean
  disabledReason: string
  title: string
  onSave?: () => void
}

interface WorkflowWorkspaceToolbarProps {
  task: WorkflowTask | null
  historicalTask?: boolean
  message: string
  onChooseWorkflow?: () => void
  navigationDisabled?: boolean
  navigationDisabledReason?: string
  codeMode: WorkflowWorkspaceModeControl
  canvasMode: WorkflowWorkspaceModeControl
  save: WorkflowWorkspaceSaveControl
  hideActions?: boolean
  children?: ReactNode
}

/**
 * 渲染 dev 工作流（Workflow）工作区唯一的导航、模式、状态与操作工具栏。
 *
 * @param props 工作流选择、编辑模式、保存能力、权威任务状态和运行操作插槽。
 * @returns OS 与 Backend 适配器共同使用的固定工具栏结构。
 */
export function WorkflowWorkspaceToolbar({
  task,
  historicalTask = false,
  message,
  onChooseWorkflow,
  navigationDisabled = false,
  navigationDisabledReason = '正在处理工作流，请稍后返回列表',
  codeMode,
  canvasMode,
  save,
  hideActions = false,
  children
}: WorkflowWorkspaceToolbarProps): React.JSX.Element {
  const liveTask = workflowTaskIsLive(task) && !historicalTask
  const visualStatus = liveTask ? workflowTaskVisualStatus(task) : 'disabled'

  return (
    <header className="workflow__toolbar persistent-authoring__toolbar">
      <div className="persistent-authoring__toolbar-navigation">
        {onChooseWorkflow ? (
          <WorkflowButton
            type="button"
            className="persistent-authoring__workflow-list"
            disabled={navigationDisabled}
            disabledReason={navigationDisabledReason}
            title="返回工作流列表"
            onClick={onChooseWorkflow}
          >
            <WorkflowToolbarIcon name="list" />
            <span>工作流列表</span>
          </WorkflowButton>
        ) : null}

        <div
          className="workflow__mode-switch"
          role="group"
          aria-label="工作流单编辑权模式"
        >
          {codeMode.visible !== false ? (
            <WorkflowButton
              type="button"
              className={codeMode.active ? 'is-active' : ''}
              aria-pressed={codeMode.active}
              disabled={codeMode.disabled}
              disabledReason={codeMode.disabledReason}
              onClick={codeMode.onSelect}
            >
              代码模式
            </WorkflowButton>
          ) : null}
          <WorkflowButton
            type="button"
            className={canvasMode.active ? 'is-active' : ''}
            aria-pressed={canvasMode.active}
            disabled={canvasMode.disabled}
            disabledReason={canvasMode.disabledReason}
            onClick={canvasMode.onSelect}
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

      {!hideActions ? <div
        className="workflow__toolbar-actions persistent-authoring__debug-toolbar"
        aria-label="工作流调试工具栏"
      >
        {historicalTask && task ? (
          <span
            className="persistent-authoring__task-status is-disabled"
            title={`OS 当前未连接；上次记录：${workflowTaskStatusLabel(task.status)}`}
            data-task-status="historical"
          >
            <i aria-hidden="true" />
            历史执行
          </span>
        ) : liveTask && task ? (
          <span
            className={`persistent-authoring__task-status is-${visualStatus}`}
            title={`${workflowTaskControlStatusLabel(task)}；任务：${workflowTaskStatusLabel(task.status)}`}
            data-task-status={task.status}
          >
            <i aria-hidden="true" />
            {workflowTaskStatusLabel(task.status)}
          </span>
        ) : (
          <span
            className="persistent-authoring__task-status is-disabled"
            title="当前没有正在运行的任务"
            data-task-status="idle"
          >
            <i aria-hidden="true" />
            待启动
          </span>
        )}

        <WorkflowButton
          type="button"
          className={[
            'persistent-authoring__debug-icon',
            save.dirty ? 'is-dirty' : ''
          ].filter(Boolean).join(' ')}
          aria-label="保存工作流"
          disabled={save.disabled}
          disabledReason={save.disabledReason}
          title={save.title}
          onClick={save.onSave}
        >
          <WorkflowToolbarIcon name="save" />
        </WorkflowButton>

        {children}
      </div> : null}
    </header>
  )
}

export type WorkflowToolbarIconName =
  | 'debug'
  | 'list'
  | 'node'
  | 'play'
  | 'refresh'
  | 'save'
  | 'settings'
  | 'step'
  | 'trace'

/**
 * 渲染工作流工具栏采用的统一线性图标。
 *
 * @param props.name 图标的稳定语义名称。
 * @returns 不参与无障碍名称计算的 SVG 图形。
 */
export function WorkflowToolbarIcon({
  name
}: {
  name: WorkflowToolbarIconName
}): React.JSX.Element {
  const paths = {
    debug: <><circle cx="9" cy="10" r="4" /><path d="M9 3v3m0 8v3M3 10h2m8 0h2M4.8 5.8l1.4 1.4m5.6 5.6 1.4 1.4M13.2 5.8l-1.4 1.4M6.2 12.8l-1.4 1.4" /></>,
    list: <><path d="M6 5h9M6 9h9M6 13h9" /><circle cx="3" cy="5" r=".6" /><circle cx="3" cy="9" r=".6" /><circle cx="3" cy="13" r=".6" /></>,
    node: <><rect x="3" y="3" width="5" height="5" rx="1" /><rect x="10" y="10" width="5" height="5" rx="1" /><path d="M8 5.5h3a2 2 0 0 1 2 2V10" /></>,
    play: <path d="m6 4 8 5-8 5Z" />,
    refresh: <><path d="M14 6a6 6 0 1 0 .4 5" /><path d="M14 3v3h-3" /></>,
    save: <><path d="M3 3h10l2 2v10H3Z" /><path d="M6 3v4h6V3M6 15v-5h6v5" /></>,
    settings: <><circle cx="9" cy="9" r="2.4" /><path d="M9 2.5v2M9 13.5v2M2.5 9h2M13.5 9h2M4.4 4.4l1.4 1.4m6.4 6.4 1.4 1.4M13.6 4.4l-1.4 1.4m-6.4 6.4-1.4 1.4" /></>,
    step: <><path d="m4 4 7 5-7 5Z" /><path d="M13 4v10" /></>,
    trace: <><circle cx="4" cy="5" r="1.5" /><circle cx="14" cy="9" r="1.5" /><circle cx="7" cy="14" r="1.5" /><path d="m5.4 5.6 7.1 2.8m.2 1.7-4.4 3M5 6.3l1.4 6.2" /></>
  } satisfies Record<WorkflowToolbarIconName, React.JSX.Element>

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
