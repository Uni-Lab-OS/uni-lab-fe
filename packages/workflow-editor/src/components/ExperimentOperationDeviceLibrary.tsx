import type {
  WorkflowActionCatalogSnapshot,
  WorkflowActionNodeTemplate
} from '@unilab/services'
import { useMemo, useState } from 'react'

import { writeWorkflowNodePaletteDragPayload } from '../utils/workflowCanvasCommands'
import { WorkflowButton } from './WorkflowButton'

export interface ExperimentOperationDeviceActionGroup {
  resourceTemplateUuid: string
  label: string
  actions: WorkflowActionNodeTemplate[]
}

interface ExperimentOperationDeviceLibraryProps {
  catalog: WorkflowActionCatalogSnapshot | null
  loading?: boolean
  error?: string | null
  disabled?: boolean
  disabledReason?: string
  dragEnabled?: boolean
  onAddAction?: (templateUuid: string) => void
  onRefresh?: () => void
}

/** 按设备资源模板组织 OS 动作目录，保持模板 UUID 作为唯一插入身份。 */
export function groupExperimentOperationDeviceActions(
  catalog: WorkflowActionCatalogSnapshot
): ExperimentOperationDeviceActionGroup[] {
  const grouped = new Map<string, WorkflowActionNodeTemplate[]>()
  for (const action of catalog.actionTemplates) {
    if (!isExperimentDeviceAction(action)) continue
    const current = grouped.get(action.resourceTemplateUuid) ?? []
    current.push(action)
    grouped.set(action.resourceTemplateUuid, current)
  }
  return [...grouped.entries()].map(([resourceTemplateUuid, actions], index) => ({
    resourceTemplateUuid,
    label: experimentDeviceLabel(actions[0], index),
    actions: [...actions].sort((left, right) => (
      left.displayName.localeCompare(right.displayName, 'zh-CN')
    ))
  })).sort((left, right) => left.label.localeCompare(right.label, 'zh-CN'))
}

/** 渲染与 HTML 原型一致的设备树、动作搜索、设备筛选和展开控制。 */
export function ExperimentOperationDeviceLibrary({
  catalog,
  loading = false,
  error = null,
  disabled = false,
  disabledReason = '请先新建或选择实验操作',
  dragEnabled = true,
  onAddAction,
  onRefresh
}: ExperimentOperationDeviceLibraryProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('all')
  const groups = useMemo(
    () => catalog ? groupExperimentOperationDeviceActions(catalog) : [],
    [catalog]
  )
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => new Set())
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleGroups = groups.map(group => ({
    ...group,
    actions: group.actions.filter(action => (
      (deviceFilter === 'all' || deviceFilter === group.resourceTemplateUuid) &&
      [group.label, action.displayName, action.name, action.actionClass ?? '']
        .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
    ))
  })).filter(group => group.actions.length > 0)
  const actionCount = groups.reduce((total, group) => total + group.actions.length, 0)

  const setAllCollapsed = (collapsed: boolean): void => {
    setCollapsedIds(collapsed
      ? new Set(groups.map(group => group.resourceTemplateUuid))
      : new Set())
  }

  return (
    <div className="operation-device-library">
      <div className="operation-device-library__tools">
        <label>
          <span className="codicon codicon-search" aria-hidden="true" />
          <span className="sr-only">搜索设备或设备动作</span>
          <input
            type="search"
            value={query}
            placeholder="搜索设备 / 动作名称 / 标识"
            onChange={event => setQuery(event.target.value)}
          />
        </label>
        <select
          aria-label="筛选设备"
          value={deviceFilter}
          onChange={event => setDeviceFilter(event.target.value)}
        >
          <option value="all">全部设备</option>
          {groups.map(group => (
            <option key={group.resourceTemplateUuid} value={group.resourceTemplateUuid}>
              {group.label}
            </option>
          ))}
        </select>
      </div>

      <div className="operation-device-library__source">
        <span>唯一来源：<strong>设备动作模块</strong></span>
        <span>{groups.length} 台 · {actionCount} 项</span>
        <div>
          <button type="button" onClick={() => setAllCollapsed(false)}>全部展开</button>
          <button type="button" onClick={() => setAllCollapsed(true)}>全部折叠</button>
        </div>
      </div>

      <div className="operation-device-library__tree" role="tree" aria-label="设备与动作树">
        {loading && groups.length === 0 ? (
          <div className="operation-device-library__state" role="status">
            <span className="codicon codicon-loading codicon-modifier-spin" aria-hidden="true" />
            <strong>正在读取设备动作</strong>
          </div>
        ) : error ? (
          <div className="operation-device-library__state is-error" role="alert">
            <span className="codicon codicon-warning" aria-hidden="true" />
            <strong>设备动作目录读取失败</strong>
            <small>{error}</small>
            {onRefresh ? <button type="button" onClick={onRefresh}>重新读取</button> : null}
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="operation-device-library__state" role="status">
            <span className="codicon codicon-circuit-board" aria-hidden="true" />
            <strong>{query ? '未找到匹配的设备动作' : '暂无设备动作'}</strong>
            <small>{query ? '请调整搜索条件。' : '启动 OS 并完成设备上报后显示。'}</small>
          </div>
        ) : visibleGroups.map(group => {
          const collapsed = collapsedIds.has(group.resourceTemplateUuid)
          const actionListId = `operation-device-actions-${group.resourceTemplateUuid}`
          return (
            <section
              key={group.resourceTemplateUuid}
              className={`operation-device-library__device${collapsed ? ' is-collapsed' : ''}`}
              role="treeitem"
              aria-expanded={!collapsed}
            >
              <button
                type="button"
                className="operation-device-library__device-head"
                aria-controls={actionListId}
                aria-expanded={!collapsed}
                title={group.label}
                onClick={() => setCollapsedIds(current => {
                  const next = new Set(current)
                  if (next.has(group.resourceTemplateUuid)) {
                    next.delete(group.resourceTemplateUuid)
                  } else {
                    next.add(group.resourceTemplateUuid)
                  }
                  return next
                })}
              >
                <span className="operation-device-library__tree-toggle">
                  <span
                    className={`codicon codicon-chevron-${collapsed ? 'right' : 'down'}`}
                    aria-hidden="true"
                  />
                </span>
                <i><span className="codicon codicon-circuit-board" aria-hidden="true" /></i>
                <span>
                  <strong>{group.label}</strong>
                  <small>{group.resourceTemplateUuid}</small>
                </span>
                <em title={`${group.actions.length} 个动作`}>
                  {group.actions.length}
                </em>
              </button>
              {!collapsed ? (
                <div
                  id={actionListId}
                  className="operation-device-library__actions"
                  role="group"
                  aria-label={`${group.label}设备动作`}
                >
                  {group.actions.map(action => (
                    <WorkflowButton
                      key={action.uuid}
                      type="button"
                      disabled={disabled || !onAddAction}
                      disabledReason={disabledReason}
                      title={`${action.displayName || action.name} · ${action.name}`}
                      draggable={dragEnabled && !disabled && Boolean(onAddAction)}
                      onDragStart={event => {
                        if (!dragEnabled || disabled || !onAddAction) {
                          event.preventDefault()
                          return
                        }
                        writeWorkflowNodePaletteDragPayload(event.dataTransfer, {
                          kind: 'action',
                          templateUuid: action.uuid
                        })
                      }}
                      onClick={() => onAddAction?.(action.uuid)}
                    >
                      <span className="codicon codicon-symbol-method" aria-hidden="true" />
                      <span>
                        <strong>{action.displayName || action.name}</strong>
                        <small>{action.name}</small>
                      </span>
                    </WorkflowButton>
                  ))}
                </div>
              ) : null}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function isExperimentDeviceAction(action: WorkflowActionNodeTemplate): boolean {
  const deviceClass = action.actionClass?.split(':').at(-1)?.trim() ?? ''
  return Boolean(action.resourceTemplateUuid) &&
    deviceClass.endsWith('Device') &&
    !deviceClass.endsWith('EmbeddedSimDevice') &&
    action.actionClass !== 'unilabos.workflow.authoring:material_source' &&
    action.actionType !== 'material_source'
}

function experimentDeviceLabel(
  action: WorkflowActionNodeTemplate | undefined,
  index: number
): string {
  const className = action?.actionClass?.split(':').at(-1)?.trim()
  if (className) return experimentDeviceDisplayName(className)
  return `设备 ${index + 1}`
}

/** 把稳定设备类型映射为实验室中使用的设备名称。 */
function experimentDeviceDisplayName(className: string): string {
  const names: Array<[RegExp, string]> = [
    [/MagneticStirrerDevice$/u, 'S04 磁搅'],
    [/Photo(?:Shooting|Shotting)Device$/u, 'S05 拍照检测'],
    [/PipettingStationDevice$/u, 'S09 移液站'],
    [/PumpDevice$/u, 'S06 注射泵'],
    [/RobotDevice$/u, 'SZLab 机械臂'],
    [/PolyPLCDevice$/u, 'SZLab PLC'],
    [/S07SolidAdditionDevice$/u, 'S07 固体加料'],
    [/S08CapStationDevice$/u, 'S08 开关盖']
  ]
  return names.find(([pattern]) => pattern.test(className))?.[1] ??
    className.replaceAll('_', ' ')
}
