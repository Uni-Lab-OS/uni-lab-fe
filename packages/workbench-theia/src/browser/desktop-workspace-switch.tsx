import * as React from 'react'

import { desktopWorkspaceApi } from './desktop-workspace'

/**
 * 渲染桌面端各会话状态共用的工作区选择入口。
 *
 * @param props 可选的当前工作区短名称；省略时使用默认动作文案。
 * @returns 桌面工作区能力可用时返回选择按钮，否则不渲染入口。
 */
export function DesktopWorkspaceSwitchButton({
  label = '选择工作区'
}: {
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
      await api.selectDirectory()
      setSwitching(false)
    } catch {
      setSwitching(false)
    }
  }, [api, switching])

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
