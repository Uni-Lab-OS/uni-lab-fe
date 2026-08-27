import * as React from 'react'

import type { WorkbenchConfigurationKind } from './workbench-configuration-dialog'
import { DesktopWorkspaceSwitchButton } from './desktop-workspace-switch'

/**
 * 渲染退出当前模式后的无登录入口，只负责模式意图选择。
 *
 * @param props 当前工作区名称、模式配置回调和可选返回动作。
 * @returns 仿真调试、真实设备调试、生产模式三种明确入口。
 * @safety 选择卡片只打开配置，不自动启动 OS、切换权威或发布数据。
 */
export function WorkbenchModeEntry({
  workspaceLabel,
  onConfigure,
  onReturn
}: {
  workspaceLabel: string
  onConfigure: (kind: WorkbenchConfigurationKind) => void
  onReturn?: () => void
}): React.JSX.Element {
  return (
    <div className="unilab-mode-entry" role="dialog" aria-modal="true">
      <section className="unilab-mode-entry__panel">
        <header>
          <div className="unilab-mode-entry__brand">
            <span aria-hidden="true"><i /><i /><i /></span>
            <div>
              <strong>UNI·LAB</strong>
              <small>WORKBENCH</small>
            </div>
          </div>
          <DesktopWorkspaceSwitchButton label={workspaceLabel} />
        </header>
        <div className="unilab-mode-entry__intro">
          <span>WORK MODE / 工作模式</span>
          <h1>选择接下来要进入的工作模式</h1>
          <p>无需登录。运行配置会保存在当前工作区，并继续由 Workspace Host 执行。</p>
        </div>
        <div className="unilab-mode-entry__cards">
          <ModeCard
            index="01"
            icon="codicon-beaker"
            title="仿真调试"
            description="使用设备图与 PLC-Sim 调试工作流，不连接真实生产权威。"
            accent="cyan"
            onSelect={() => onConfigure('simulation')}
          />
          <ModeCard
            index="02"
            icon="codicon-plug"
            title="真实设备调试"
            description="使用当前工作区设备包与设备图连接真实设备。"
            accent="blue"
            onSelect={() => onConfigure('hardware')}
          />
          <ModeCard
            index="03"
            icon="codicon-server-process"
            title="生产模式"
            description="连接生产 Backend 与调度器（Scheduler），使用远端权威。"
            accent="navy"
            onSelect={() => onConfigure('production')}
          />
        </div>
        {onReturn ? (
          <footer>
            <button type="button" onClick={onReturn}>返回当前工作台</button>
          </footer>
        ) : null}
      </section>
    </div>
  )
}

/** 渲染一个只打开配置、不直接执行运行操作的模式卡片。 */
function ModeCard({
  index,
  icon,
  title,
  description,
  accent,
  onSelect
}: {
  index: string
  icon: string
  title: string
  description: string
  accent: 'cyan' | 'blue' | 'navy'
  onSelect: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="unilab-mode-entry__card"
      data-accent={accent}
      onClick={onSelect}
    >
      <span className="unilab-mode-entry__card-index">{index}</span>
      <span className={`codicon ${icon}`} aria-hidden="true" />
      <strong>{title}</strong>
      <small>{description}</small>
      <span className="unilab-mode-entry__card-action">配置并进入 →</span>
    </button>
  )
}
