import * as React from 'react'

import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'
import type { WorkbenchConfigurationKind } from './workbench-configuration-dialog'
import type { WorkbenchConnectionMode } from './workbench-connection-profile'

/**
 * 渲染模式相关的 Workbench 顶部入口，保持配置与退出动作语义一致。
 *
 * @param props 当前模式、工作区摘要、视图名称与窄交互回调。
 * @returns 调试模式或生产模式对应的单行导航栏。
 * @safety 所有按钮只提交导航意图；运行控制仍由配置面板和 WorkbenchSession 执行。
 */
export function WorkbenchTopBar({
  connectionMode,
  configurationKind,
  identityLabel,
  viewLabel,
  workspaceLabel,
  onConfigure,
  onExitMode,
  onOpenAssistant
}: {
  connectionMode: WorkbenchConnectionMode
  configurationKind: WorkbenchConfigurationKind | null
  identityLabel: string
  viewLabel: string
  workspaceLabel: string
  onConfigure: (kind: WorkbenchConfigurationKind) => void
  onExitMode: () => void
  onOpenAssistant: () => void
}): React.JSX.Element {
  const production = connectionMode === 'backend'
  return (
    <header className="unilab-workbench__bar">
      <div className="unilab-workbench__identity">
        <strong>UniLab Workbench</strong>
        <span>{identityLabel}</span>
        <span className="unilab-workbench__view-mode">{viewLabel}</span>
      </div>
      <div className="unilab-workbench__controls">
        <nav aria-label={production ? '生产模式' : '调试模式'}>
          <button type="button" onClick={onOpenAssistant}>
            <span className="codicon codicon-hubot" aria-hidden="true" />
            助手
          </button>
          {production ? (
            <button
              type="button"
              className={configurationKind === 'production' ? 'is-active' : ''}
              aria-expanded={configurationKind === 'production'}
              onClick={() => onConfigure('production')}
            >
              <span className="codicon codicon-server-process" aria-hidden="true" />
              生产配置
            </button>
          ) : (
            <>
              <button
                type="button"
                className={configurationKind === 'simulation' ? 'is-active' : ''}
                aria-expanded={configurationKind === 'simulation'}
                onClick={() => onConfigure('simulation')}
              >
                <span className="codicon codicon-beaker" aria-hidden="true" />
                仿真调试
              </button>
              <button
                type="button"
                className={configurationKind === 'hardware' ? 'is-active' : ''}
                aria-expanded={configurationKind === 'hardware'}
                onClick={() => onConfigure('hardware')}
              >
                <span className="codicon codicon-plug" aria-hidden="true" />
                真实设备调试
              </button>
            </>
          )}
          <DesktopWorkspaceSwitchButton label={workspaceLabel} />
          <button type="button" onClick={onExitMode}>
            <span className="codicon codicon-sign-out" aria-hidden="true" />
            {production ? '退出生产模式' : '退出调试模式'}
          </button>
        </nav>
      </div>
    </header>
  )
}
