import * as React from 'react'

import {
  desktopWorkspaceApi,
  type DesktopWorkspaceSnapshot
} from './desktop-workspace'

/**
 * 渲染桌面端各会话状态共用的工作区选择入口。
 *
 * @param props 可选的当前工作区短名称；省略时使用默认动作文案。
 * @returns 桌面工作区能力可用时返回选择按钮，否则不渲染入口。
 */
export function DesktopWorkspaceSwitchButton({
  entryMode = 'debug',
  label = '选择工作区'
}: {
  entryMode?: 'debug' | 'production'
  label?: string
} = {}): React.JSX.Element | null {
  const api = React.useMemo(() => desktopWorkspaceApi(), [])
  const [available, setAvailable] = React.useState(false)
  const [switching, setSwitching] = React.useState(false)

  React.useEffect(() => {
    let active = true
    void api?.getSnapshot().then((snapshot) => {
      if (active) setAvailable(snapshot.phase !== 'unavailable')
    }).catch(() => undefined)
    return () => { active = false }
  }, [api])

  /**
   * 打开系统目录选择器并串行完成工作区切换。
   *
   * @returns 工作区选择结束后的 Promise；取消或失败时恢复按钮可用状态。
   */
  const selectWorkspace = React.useCallback(async (): Promise<void> => {
    if (!api || switching) return
    setSwitching(true)
    try {
      await api.selectDirectory(entryMode)
      setSwitching(false)
    } catch {
      setSwitching(false)
    }
  }, [api, entryMode, switching])

  if (!available) return null
  return (
    <button
      type="button"
      className="unilab-workspace-switch"
      disabled={switching}
      title="选择并打开 UniLab 工作区"
      onClick={() => { void selectWorkspace() }}
    >
      <span
        className="unilab-workspace-switch__icon codicon codicon-folder-opened"
        aria-hidden="true"
      />
      <span className="unilab-workspace-switch__label">
        {switching ? '正在切换…' : label}
      </span>
    </button>
  )
}

/**
 * 渲染首页工作区选择器：既可打开系统目录选择器，也可直接输入目录。
 *
 * @param props 当前入口模式与目录值回调。
 * @returns 带目录输入框和文件夹选择按钮的工作区选择控件。
 */
export function DesktopWorkspacePicker({
  entryMode = 'debug',
  value,
  onChange,
  onSelected,
  onError
}: {
  entryMode?: 'debug' | 'production'
  value: string
  onChange: (value: string) => void
  onSelected?: (snapshot: DesktopWorkspaceSnapshot) => void
  onError?: (message: string) => void
}): React.JSX.Element {
  const api = React.useMemo(() => desktopWorkspaceApi(), [])
  const [available, setAvailable] = React.useState(Boolean(api))
  const [switching, setSwitching] = React.useState(false)

  React.useEffect(() => {
    let active = true
    if (!api) {
      setAvailable(false)
      return () => { active = false }
    }
    void api.getSnapshot().then((snapshot) => {
      if (active) setAvailable(snapshot.phase !== 'unavailable')
    }).catch(() => {
      if (active) setAvailable(false)
    })
    return () => { active = false }
  }, [api])

  const handleSnapshot = React.useCallback((snapshot: DesktopWorkspaceSnapshot): void => {
    onSelected?.(snapshot)
    if (snapshot.error) onError?.(snapshot.error)
  }, [onError, onSelected])

  const selectWorkspace = React.useCallback(async (): Promise<void> => {
    if (!api || switching) return
    setSwitching(true)
    try {
      const snapshot = await api.selectDirectory(entryMode)
      handleSnapshot(snapshot)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      setSwitching(false)
    }
  }, [api, entryMode, handleSnapshot, onError, switching])

  const openTypedWorkspace = React.useCallback(async (): Promise<void> => {
    const path = value.trim()
    if (!api || switching || !path) {
      if (!path) onError?.('请输入工作区目录')
      return
    }
    setSwitching(true)
    try {
      const snapshot = await api.openPath(path, entryMode)
      handleSnapshot(snapshot)
    } catch (error) {
      onError?.(error instanceof Error ? error.message : String(error))
    } finally {
      setSwitching(false)
    }
  }, [api, entryMode, handleSnapshot, onError, switching, value])

  return (
    <div className="unilab-workspace-picker">
      <div className="unilab-workspace-picker__input-wrap">
        <span
          className="unilab-workspace-picker__icon codicon codicon-folder-opened"
          aria-hidden="true"
        />
        <input
          aria-label="工作区目录"
          className="unilab-workspace-picker__input"
          value={value}
          placeholder="输入工作区目录"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void openTypedWorkspace()
            }
          }}
        />
      </div>
      <button
        type="button"
        className="unilab-workspace-picker__button"
        disabled={!available || switching}
        title="选择并打开 UniLab 工作区目录"
        onClick={() => { void selectWorkspace() }}
      >
        <span className="codicon codicon-folder-opened" aria-hidden="true" />
        选择文件夹
      </button>
      <button
        type="button"
        className="unilab-workspace-picker__button unilab-workspace-picker__button--open"
        disabled={!available || switching || !value.trim()}
        title="打开输入的工作区目录"
        onClick={() => { void openTypedWorkspace() }}
      >
        {switching ? '正在打开…' : '打开目录'}
      </button>
    </div>
  )
}
