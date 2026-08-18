import {
  ApplicationShell,
  Message,
  WidgetManager
} from '@theia/core/lib/browser'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from 'react'

import {
  DomainEntryPanel,
  type DomainEntryDefinition
} from './domain-entry-panel'
import { UniLabAgentWidget } from './unilab-agent-widget'

const AGENT_ENTRY: DomainEntryDefinition<'agent'> = {
  mode: 'agent',
  label: 'Agent',
  caption: 'Agent · 当前工作区会话',
  description: '打开当前工作区的 Coding Agent 会话，并保持内容面板位于右侧。',
  iconClass: 'codicon codicon-hubot',
  eyebrow: 'AGENT'
}

const AGENT_PANEL_WIDTH_PROPERTY = '--unilab-agent-panel-width'

@injectable()
export class UniLabAgentNavigatorWidget extends ReactWidget {
  static readonly ID = 'unilab:agent-navigation'

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell

  @inject(WidgetManager)
  protected readonly widgetManager!: WidgetManager

  protected agentPanelResizeObserver: ResizeObserver | undefined

  @postConstruct()
  protected init(): void {
    this.id = UniLabAgentNavigatorWidget.ID
    this.title.label = AGENT_ENTRY.label
    this.title.caption = AGENT_ENTRY.caption
    this.title.iconClass = AGENT_ENTRY.iconClass
    this.title.closable = false
    this.node.style.minWidth = '196px'
    this.toDispose.push(this.shell.onDidChangeActiveWidget(() => {
      this.updateActivityPresentation()
      this.update()
    }))
    this.toDispose.push(this.shell.onDidChangeCurrentWidget(() => {
      this.updateActivityPresentation()
      this.update()
    }))
    this.toDispose.push({
      dispose: () => this.stopTrackingAgentPanelWidth()
    })
    this.updateActivityPresentation()
    this.update()
  }

  protected isAgentVisible(): boolean {
    const agent = this.shell.getWidgetById(UniLabAgentWidget.ID)
    if (!agent || !this.shell.isExpanded('right')) return false
    return this.shell.getTabBarFor(agent)?.currentTitle === agent.title
  }

  protected readonly toggleAgent = async (): Promise<void> => {
    await this.shell.collapsePanel('left')
    const agent = await this.widgetManager.getOrCreateWidget(
      UniLabAgentWidget.ID
    )
    const tabBar = this.shell.getTabBarFor(agent)
    if (
      tabBar &&
      this.shell.isExpanded('right') &&
      tabBar.currentTitle === agent.title
    ) {
      document.body.classList.remove('unilab-agent-panel-visible')
      this.stopTrackingAgentPanelWidth()
      await this.shell.collapsePanel('right')
    } else {
      // 先恢复右侧容器的布局，否则 display:none 会让 Theia
      // 无法完成 TabBar 激活，面板会保持“已打开但不可见”。
      document.body.classList.add('unilab-agent-panel-visible')
      if (!tabBar) await this.shell.addWidget(agent, { area: 'right' })
      this.shell.expandPanel('right')
      await this.shell.activateWidget(UniLabAgentWidget.ID)
      this.trackAgentPanelWidth()
    }
    this.updateActivityPresentation()
    this.update()
  }

  /** Keep the material workspace inset equal to the restored/resized Agent panel. */
  protected trackAgentPanelWidth(): void {
    const panel = document.getElementById('theia-right-content-panel')
    if (!panel) return
    this.stopTrackingAgentPanelWidth(false)
    const publishWidth = (): void => {
      const width = Math.ceil(panel.getBoundingClientRect().width)
      if (width > 0) {
        document.body.style.setProperty(
          AGENT_PANEL_WIDTH_PROPERTY,
          `${width}px`
        )
      }
    }
    this.agentPanelResizeObserver = new ResizeObserver(publishWidth)
    this.agentPanelResizeObserver.observe(panel)
    publishWidth()
  }

  protected stopTrackingAgentPanelWidth(clearProperty = true): void {
    this.agentPanelResizeObserver?.disconnect()
    this.agentPanelResizeObserver = undefined
    if (clearProperty) {
      document.body.style.removeProperty(AGENT_PANEL_WIDTH_PROPERTY)
    }
  }

  protected updateActivityPresentation(): void {
    const active = this.isAgentVisible()
    this.title.dataset = {
      unilabGroup: 'true',
      unilabNavigation: 'agent',
      unilabActive: String(active)
    }
    this.title.className = `unilab-workbench-activity${
      active ? ' is-domain-active' : ''
    }`
  }

  protected override render(): React.ReactElement {
    return (
      <DomainEntryPanel
        entry={AGENT_ENTRY}
        active={this.isAgentVisible()}
        onOpen={() => void this.toggleAgent()}
      />
    )
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    void this.toggleAgent()
  }
}
