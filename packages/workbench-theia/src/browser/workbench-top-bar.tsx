import * as React from 'react'
import type { WorkbenchEnvironmentLogKind } from '@unilab/workbench-session'

import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'
import type { WorkbenchConfigurationKind } from './workbench-configuration-dialog'
import type { WorkbenchConnectionMode } from './workbench-connection-profile'
import {
  WorkbenchRuntimeLogLauncher,
  type WorkbenchRuntimeLogPaths
} from './workbench-runtime-log-drawer'

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
  debugTarget,
  viewLabel,
  workspaceLabel,
  onConfigure,
  onExitMode,
  onOpenAssistant,
  onReadEnvironmentLog,
  onOpenLog,
  runtimeLogPaths
}: {
  connectionMode: WorkbenchConnectionMode
  configurationKind: WorkbenchConfigurationKind | null
  debugTarget: 'simulation' | 'hardware'
  viewLabel: string
  workspaceLabel: string
  onConfigure: (kind: WorkbenchConfigurationKind) => void
  onExitMode: () => void
  onOpenAssistant: () => void
  onReadEnvironmentLog?: (
    kind: WorkbenchEnvironmentLogKind
  ) => Promise<string>
  onOpenLog?: (path: string) => Promise<void>
  runtimeLogPaths?: WorkbenchRuntimeLogPaths
}): React.JSX.Element {
  const production = connectionMode === 'backend'
  return (
    <header className="unilab-workbench__bar">
      <nav className="unilab-workbench__breadcrumb" aria-label="当前位置">
        <span>{production ? '实验生产平台' : '实验调试平台'}</span>
        <span className="unilab-workbench__breadcrumb-separator" aria-hidden="true">
          /
        </span>
        <strong aria-current="page">{viewLabel}</strong>
      </nav>
      <div className="unilab-workbench__controls">
        <nav aria-label={production ? '生产模式' : '调试模式'}>
          <button type="button" onClick={onOpenAssistant}>
            <span className="codicon codicon-hubot" aria-hidden="true" />
            助手
          </button>
          {onReadEnvironmentLog ? (
            <WorkbenchRuntimeLogLauncher
              onReadLog={onReadEnvironmentLog}
              onOpenLog={onOpenLog}
              logPaths={runtimeLogPaths}
            />
          ) : null}
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
            <div
              className="unilab-workbench__debug-switch"
              role="radiogroup"
              aria-label="调试运行目标"
            >
              <button
                type="button"
                role="radio"
                className={debugTarget === 'simulation' ? 'is-active' : ''}
                aria-checked={debugTarget === 'simulation'}
                aria-expanded={configurationKind === 'simulation'}
                onClick={() => onConfigure('simulation')}
              >
                仿真调试
              </button>
              <button
                type="button"
                role="radio"
                className={debugTarget === 'hardware' ? 'is-active' : ''}
                aria-checked={debugTarget === 'hardware'}
                aria-expanded={configurationKind === 'hardware'}
                onClick={() => onConfigure('hardware')}
              >
                真实设备调试
              </button>
            </div>
          )}
          <DesktopWorkspaceSwitchButton
            entryMode={production ? 'production' : 'debug'}
            label={workspaceLabel}
          />
          <button type="button" onClick={onExitMode}>
            <span className="codicon codicon-sign-out" aria-hidden="true" />
            {production ? '退出生产模式' : '退出调试模式'}
          </button>
        </nav>
      </div>
    </header>
  )
}
