import * as React from 'react'

import type { WorkbenchConfigurationKind } from './workbench-configuration-dialog'
import { desktopWorkspaceApi } from './desktop-workspace'
import { DesktopWorkspacePicker } from './desktop-workspace-switch'

export type WorkbenchEntryMode = 'debug' | 'production'

export interface WorkbenchModeEntryStatus {
  label: string
  tone: 'online' | 'idle' | 'attention'
}

/**
 * 渲染与产品原型一致的无登录工作模式入口。
 *
 * @param props 当前工作区、权威状态、模式配置回调和可选恢复内容。
 * @returns 调试/生产模式与设备包工作区组成的工业控制台入口。
 * @safety 入口只选择模式并打开既有配置；不会自动启动 OS、切换权威或发布数据。
 */
export function WorkbenchModeEntry({
  workspaceLabel,
  workspacePath,
  initialMode = 'debug',
  status = { label: 'SERVICE ONLINE', tone: 'online' },
  notice,
  supportActions,
  onWorkspaceError,
  onConfigure,
  onReturn
}: {
  workspaceLabel: string
  workspacePath?: string | null
  initialMode?: WorkbenchEntryMode
  status?: WorkbenchModeEntryStatus
  notice?: React.ReactNode
  supportActions?: React.ReactNode
  onWorkspaceError?: (message: string) => void
  onConfigure: (kind: WorkbenchConfigurationKind) => void
  onReturn?: () => void
}): React.JSX.Element {
  const dialogRef = React.useRef<HTMLDivElement | null>(null)
  const [mode, setMode] = React.useState<WorkbenchEntryMode>(initialMode)
  const [activeWorkspace, setActiveWorkspace] = React.useState<string | null>(
    workspacePath ?? null
  )
  const [workspaceInput, setWorkspaceInput] = React.useState(workspacePath ?? '')

  React.useEffect(() => setMode(initialMode), [initialMode])
  React.useEffect(() => {
    setActiveWorkspace(workspacePath ?? null)
    setWorkspaceInput(workspacePath ?? '')
  }, [workspacePath])
  React.useEffect(() => {
    let active = true
    const api = desktopWorkspaceApi()
    if (!api) return
    void api.getSnapshot().then((snapshot) => {
      if (active && snapshot.activeWorkspace) {
        setActiveWorkspace(snapshot.activeWorkspace)
        setWorkspaceInput(snapshot.activeWorkspace)
      }
    }).catch(() => undefined)
    return () => { active = false }
  }, [])

  React.useEffect(() => {
    if (!onReturn || !dialogRef.current) return undefined
    const dialog = dialogRef.current
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    const background = Array.from(dialog.parentElement?.children ?? [])
      .filter((element): element is HTMLElement => (
        element instanceof HTMLElement && element !== dialog
      ))
      .map((element) => ({
        element,
        inert: element.hasAttribute('inert')
      }))
    background.forEach(({ element }) => element.setAttribute('inert', ''))

    const focusFrame = requestAnimationFrame(() => {
      const initialFocus = dialog.querySelector<HTMLElement>(
        'input[name="workbench-mode"]:checked'
      )
      ;(initialFocus ?? dialog).focus({ preventScroll: true })
    })
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onReturn()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      ))
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    dialog.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelAnimationFrame(focusFrame)
      dialog.removeEventListener('keydown', handleKeyDown)
      background.forEach(({ element, inert }) => {
        if (!inert) element.removeAttribute('inert')
      })
      previousFocus?.focus({ preventScroll: true })
    }
  }, [onReturn])

  const resolvedWorkspacePath = workspaceInput.trim()
    || activeWorkspace
    || workspacePath
    || ''
  const resolvedWorkspaceLabel = resolvedWorkspacePath
    ? workspaceShortName(resolvedWorkspacePath)
    : workspaceLabel
  const submitLabel = mode === 'production'
    ? '进入生产模式'
    : '进入调试模式'

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onConfigure(mode === 'production' ? 'production' : 'simulation')
  }

  return (
    <div
      ref={dialogRef}
      className="unilab-mode-entry"
      role="dialog"
      aria-modal={onReturn ? true : undefined}
      aria-labelledby="workbench-mode-title"
      tabIndex={onReturn ? -1 : undefined}
    >
      <section className="unilab-mode-entry__visual" aria-label="Uni-Lab 产品介绍">
        <div className="unilab-mode-entry__brand">
          <span className="unilab-mode-entry__brand-mark" aria-hidden="true">U</span>
          <span>
            <strong>Uni-Lab Studio</strong>
            <small>INDUSTRIAL LAB CONTROL</small>
          </span>
        </div>

        <div className="unilab-mode-entry__hero">
          <span className="unilab-mode-entry__hero-label">
            CONTROL SYSTEM / 01
          </span>
          <h1>实验自动化<br />运行控制台</h1>
          <p>
            连接实验设备、控制流程执行并管理生产任务，为调试、验证、排程和运行审计提供统一操作界面。
          </p>
          <div className="unilab-mode-entry__capabilities">
            <EntryCapability
              index="01"
              title="设备控制层"
              description="设备连接 · 动作 · 状态"
            />
            <EntryCapability
              index="02"
              title="流程编排层"
              description="操作封装 · 工作流 · 验证"
            />
            <EntryCapability
              index="03"
              title="生产运行层"
              description="任务 · 排程 · 追溯"
            />
          </div>
        </div>

        <div className="unilab-mode-entry__control-status">
          <span><i aria-hidden="true" /> WORKSPACE CONTROL</span>
          <span>LOCAL WORKSPACE</span>
        </div>
      </section>

      <section className="unilab-mode-entry__selector" aria-labelledby="workbench-mode-title">
        <div className="unilab-mode-entry__card">
          <header className="unilab-mode-entry__kicker">
            <span>UNILAB / WORKBENCH</span>
            <span data-tone={status.tone}>
              <i aria-hidden="true" /> {status.label}
            </span>
          </header>

          <div className="unilab-mode-entry__card-head">
            <h2 id="workbench-mode-title">选择工作模式</h2>
            <p>选择设备包工作区，然后进入调试或生产工作台</p>
          </div>

          <form
            className="unilab-mode-entry__form"
            data-mode={mode}
            onSubmit={submit}
          >
            <fieldset className="unilab-mode-entry__modes">
              <legend>进入模式</legend>
              <div role="radiogroup" aria-label="选择进入模式">
                <ModeChoice
                  checked={mode === 'debug'}
                  description="仿真、真实设备与流程调试"
                  label="调试模式"
                  mode="debug"
                  onSelect={setMode}
                />
                <ModeChoice
                  checked={mode === 'production'}
                  description="Backend、调度、任务与执行监控"
                  label="生产模式"
                  mode="production"
                  onSelect={setMode}
                />
              </div>
            </fieldset>

            <div className="unilab-mode-entry__workspace">
              <div className="unilab-mode-entry__workspace-head">
                <span>工作区</span>
                <small>当前设备包</small>
              </div>
              <div className="unilab-mode-entry__workspace-control">
                <DesktopWorkspacePicker
                  entryMode={mode}
                  value={workspaceInput}
                  onChange={setWorkspaceInput}
                  onSelected={(snapshot) => {
                    if (snapshot.activeWorkspace) {
                      setActiveWorkspace(snapshot.activeWorkspace)
                      setWorkspaceInput(snapshot.activeWorkspace)
                    }
                  }}
                  onError={onWorkspaceError}
                />
              </div>
              <code title={resolvedWorkspacePath || resolvedWorkspaceLabel}>
                {resolvedWorkspacePath || '请选择或输入一个设备包工作区'}
              </code>
            </div>

            {notice}

            <button className="unilab-mode-entry__submit" type="submit">
              {submitLabel}
            </button>
          </form>

          {supportActions ? (
            <div className="unilab-mode-entry__support-actions">
              {supportActions}
            </div>
          ) : null}

          {onReturn ? (
            <button
              className="unilab-mode-entry__return"
              type="button"
              onClick={onReturn}
            >
              返回当前工作台
            </button>
          ) : null}

          <p className="unilab-mode-entry__footer">
            Uni-Lab Studio · Local Workspace
          </p>
        </div>
      </section>
    </div>
  )
}

/** 渲染左侧控制台的单层能力说明。 */
function EntryCapability({
  index,
  title,
  description
}: {
  index: string
  title: string
  description: string
}): React.JSX.Element {
  return (
    <div>
      <i>{index}</i>
      <strong>{title}</strong>
      <small>{description}</small>
    </div>
  )
}

/** 渲染一个不会直接启动运行时的模式单选卡。 */
function ModeChoice({
  checked,
  description,
  label,
  mode,
  onSelect
}: {
  checked: boolean
  description: string
  label: string
  mode: WorkbenchEntryMode
  onSelect: (mode: WorkbenchEntryMode) => void
}): React.JSX.Element {
  return (
    <label className="unilab-mode-entry__mode-choice">
      <input
        type="radio"
        name="workbench-mode"
        value={mode}
        checked={checked}
        onChange={() => onSelect(mode)}
      />
      <span>{label}</span>
      <small>{description}</small>
    </label>
  )
}

/** 从跨平台工作区路径中取得用于入口展示的稳定短名称。 */
function workspaceShortName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}
