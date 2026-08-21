import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type {
  WorkbenchConnectionMode,
  WorkbenchConnectionTargets
} from './workbench-connection-profile'
import {
  workbenchAuthorityTransitionLabel,
  type WorkbenchAuthorityTransitionPhase
} from './workbench-authority-transition'

export type WorkbenchConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'error'

interface WorkbenchConnectionSelectorProps {
  targets: WorkbenchConnectionTargets
  selectedMode: WorkbenchConnectionMode
  connection: WorkbenchConnectionState
  targetConnections?: Partial<Record<
    WorkbenchConnectionMode,
    WorkbenchConnectionState
  >>
  switchBlockedReason?: string | null
  transitionPhase?: WorkbenchAuthorityTransitionPhase | null
  transitionFailure?: {
    target: WorkbenchConnectionMode
    message: string
    canForce: boolean
    canCancelTasks?: boolean
  } | null
  authorityWarning?: string | null
  defaultOpen?: boolean
  onSelect: (mode: WorkbenchConnectionMode) => void
  onForceSelect?: (mode: WorkbenchConnectionMode) => void
  onCancelTasksAndSelect?: (mode: WorkbenchConnectionMode) => void
  onRetry?: () => void
}

/**
 * 呈现 Workbench 的显式运行连接与调度权威选择。
 * @param props 两个连接目标、当前健康状态、切换门禁和用户操作回调。
 * @returns 可键盘访问的连接摘要与两项互斥选择面板。
 */
export function WorkbenchConnectionSelector({
  targets,
  selectedMode,
  connection,
  targetConnections,
  switchBlockedReason,
  transitionPhase,
  transitionFailure,
  authorityWarning,
  defaultOpen = false,
  onSelect,
  onForceSelect,
  onCancelTasksAndSelect,
  onRetry
}: WorkbenchConnectionSelectorProps): React.JSX.Element {
  const selectorRef = useRef<HTMLDetailsElement>(null)
  const requestedMode = useRef<WorkbenchConnectionMode | null>(null)
  const [open, setOpen] = useState(defaultOpen)
  const selected = targets[selectedMode]
  const statusLabel = connectionStatusLabel(selectedMode, connection)

  useEffect(() => {
    const selector = selectorRef.current
    if (!selector) return undefined

    const handleOutsidePointerDown = (event: PointerEvent): void => {
      if (selector.open && !selector.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown)
    return () => document.removeEventListener('pointerdown', handleOutsidePointerDown)
  }, [])

  useEffect(() => {
    if (requestedMode.current !== selectedMode) return
    requestedMode.current = null
    setOpen(false)
  }, [selectedMode])

  /** 用户明确选择由常驻 Workspace Backend 持有后续任务权威。 */
  const selectLocal = useCallback((): void => {
    requestedMode.current = 'local'
    onSelect('local')
  }, [onSelect])

  /** 用户明确选择由 Backend 持有后续任务权威。 */
  const selectBackend = useCallback((): void => {
    requestedMode.current = 'backend'
    onSelect('backend')
  }, [onSelect])

  const busy = Boolean(transitionPhase)

  return (
    <details
      ref={selectorRef}
      className="unilab-workbench-connection"
      data-connection-state={connection}
      data-authority-profile={selected.authorityProfile}
      data-authority-warning={authorityWarning ? 'true' : 'false'}
      open={open}
      onToggle={event => setOpen(event.currentTarget.open)}
    >
      <summary aria-label={`运行连接：${statusLabel}`}>
        <span className="unilab-workbench-connection__status" aria-hidden="true" />
        <span className="unilab-workbench-connection__summary-copy">
          <strong>{selected.title}</strong>
          <small>{transitionPhase
            ? workbenchAuthorityTransitionLabel(transitionPhase)
            : authorityWarning ?? statusLabel}</small>
        </span>
        <span className="codicon codicon-chevron-down" aria-hidden="true" />
      </summary>
      <div className="unilab-workbench-connection__popover">
        <header>
          <strong>选择运行连接</strong>
          <p>选择 Backend 时会自动保存、替换定义并验证；Backend 内容只读。</p>
        </header>
        <div
          className="unilab-workbench-connection__options"
          role="group"
          aria-label="选择运行环境"
        >
          <ConnectionOption
            target={targets.local}
            selected={selectedMode === 'local'}
            connection={targetConnections?.local}
            disabled={selectedMode !== 'local' && (
              Boolean(switchBlockedReason) || busy
            )}
            onSelect={selectLocal}
          />
          <ConnectionOption
            target={targets.backend}
            selected={selectedMode === 'backend'}
            connection={targetConnections?.backend}
            disabled={selectedMode !== 'backend' && (
              Boolean(switchBlockedReason) || busy
            )}
            onSelect={selectBackend}
          />
        </div>
        <p className="unilab-workbench-connection__safety-note">
          切换运行环境前，需要先结束当前环境中的活动任务。
        </p>
        {transitionPhase ? (
          <p className="unilab-workbench-connection__progress" role="status">
            {workbenchAuthorityTransitionLabel(transitionPhase)}
          </p>
        ) : null}
        {switchBlockedReason ? (
          <p className="unilab-workbench-connection__blocked" role="alert">
            {switchBlockedReason}
          </p>
        ) : null}
        {transitionFailure ? (
          <div className="unilab-workbench-connection__transition-error" role="alert">
            <span>
              <strong>未切换到 {targets[transitionFailure.target].title}</strong>
              <small>{transitionFailure.message}</small>
            </span>
            {transitionFailure.canForce && onForceSelect ? (
              <button
                type="button"
                onClick={() => onForceSelect(transitionFailure.target)}
              >仍然强制切换</button>
            ) : null}
            {transitionFailure.canCancelTasks && onCancelTasksAndSelect ? (
              <button
                type="button"
                onClick={() => onCancelTasksAndSelect(transitionFailure.target)}
              >取消任务并切换</button>
            ) : null}
          </div>
        ) : null}
        {authorityWarning ? (
          <p className="unilab-workbench-connection__warning" role="alert">
            {authorityWarning}
          </p>
        ) : null}
        {connection === 'error' ? (
          <div className="unilab-workbench-connection__recovery" role="alert">
            <span>{statusLabel}，请检查目标进程和地址。</span>
            {onRetry ? (
              <button type="button" onClick={onRetry}>重试连接</button>
            ) : null}
          </div>
        ) : null}
      </div>
    </details>
  )
}

/**
 * 在用户完成连接选择后关闭原生详情浮层，避免遮挡后续运行操作。
 * @param selector 当前连接选择器详情元素；尚未挂载时允许为空。
 */
export function closeConnectionSelector(
  selector: Pick<HTMLDetailsElement, 'open'> | null
): void {
  if (selector) selector.open = false
}

/**
 * 点击连接选择器之外的区域时收起浮层，并保留外部控件原有的点击行为。
 * @param selector 当前连接选择器详情元素；尚未挂载时允许为空。
 * @param target 指针事件命中的节点；无法识别目标时按外部点击处理。
 */
export function closeConnectionSelectorOnOutsidePointer(
  selector: Pick<HTMLDetailsElement, 'open' | 'contains'> | null,
  target: EventTarget | null
): void {
  if (!selector?.open) return
  if (target && selector.contains(target as Node)) return
  selector.open = false
}

/**
 * 呈现单个连接目标及其调度权威，不把选中颜色当成唯一状态证据。
 * @param props 目标说明、当前选择、切换门禁和选择回调。
 * @returns 具有 aria-pressed 语义的互斥操作按钮。
 */
function ConnectionOption({
  target,
  selected,
  connection,
  disabled,
  onSelect
}: {
  target: WorkbenchConnectionTargets[WorkbenchConnectionMode]
  selected: boolean
  connection?: WorkbenchConnectionState
  disabled: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={selected ? 'is-selected' : ''}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
    >
      <span className="unilab-workbench-connection__option-title">
        <strong>{target.title}</strong>
        <small>{target.authorityProfile === 'local_scheduler'
          ? '本地调度'
          : '后端控制'}</small>
      </span>
      <span>{target.description}</span>
      <code>{target.endpointLabel}</code>
      {connection ? (
        <small className={`is-${connection}`}>
          {connection === 'connected'
            ? '可用'
            : connection === 'connecting'
              ? '检测中…'
              : '当前不可用'}
        </small>
      ) : null}
    </button>
  )
}

/**
 * 将传输健康状态转换为面向操作员的中文事实说明。
 * @param mode 当前本地 Workspace Backend 或远程 Backend 模式。
 * @param state 当前一次健康探测或托管会话状态。
 * @returns 不把连接成功误称为任务成功的短状态文本。
 */
function connectionStatusLabel(
  mode: WorkbenchConnectionMode,
  state: WorkbenchConnectionState
): string {
  const target = mode === 'backend' ? 'Backend' : 'Workspace Backend'
  if (state === 'connected') return `${target} 已连接`
  if (state === 'connecting') return `正在连接 ${target}`
  if (state === 'error') return `${target} 连接失败`
  return `${target} 未连接`
}
