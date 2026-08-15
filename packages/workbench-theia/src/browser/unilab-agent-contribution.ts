import { AbstractViewContribution } from '@theia/core/lib/browser'
import type { Command } from '@theia/core/lib/common/command'
import { injectable } from '@theia/core/shared/inversify'

import { UniLabAgentWidget } from './unilab-agent-widget'
import { UniLabAgentNavigatorWidget } from './unilab-agent-navigator-widget'

export const OpenUniLabAgent: Command = {
  id: 'unilab.agent.open',
  label: 'Open UniLab Agent'
}

export const OpenUniLabAgentNavigation: Command = {
  id: 'unilab.agent.navigation.open',
  label: '打开 Agent'
}

@injectable()
export class UniLabAgentContribution
  extends AbstractViewContribution<UniLabAgentWidget> {
  constructor() {
    super({
      widgetId: UniLabAgentWidget.ID,
      widgetName: UniLabAgentWidget.LABEL,
      defaultWidgetOptions: { area: 'right' },
      toggleCommandId: OpenUniLabAgent.id
    })
  }

}

@injectable()
export class UniLabAgentNavigationContribution
  extends AbstractViewContribution<UniLabAgentNavigatorWidget> {
  constructor() {
    super({
      widgetId: UniLabAgentNavigatorWidget.ID,
      widgetName: 'Agent',
      defaultWidgetOptions: { area: 'left', rank: 78 },
      toggleCommandId: OpenUniLabAgentNavigation.id
    })
  }
}
