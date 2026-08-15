import {
  bindViewContribution,
  FrontendApplicationContribution,
  WebSocketConnectionProvider,
  WidgetFactory
} from '@theia/core/lib/browser'
import { ContainerModule } from '@theia/core/shared/inversify'
import { PreferenceContribution } from '@theia/core/lib/common/preferences'
import { TabBarToolbarContribution } from '@theia/core/lib/browser/shell/tab-bar-toolbar/tab-bar-toolbar-registry'
import '@unilab/design-system/theme.css'

import {
  WORKBENCH_SESSION_PATH,
  WorkbenchSessionClient,
  WorkbenchSessionServer
} from '../common/workbench-session-protocol'
import {
  DeviceDomainEntryContribution,
  MaterialDomainEntryContribution,
  RobotBenchDomainEntryContribution,
  RobotDebugDomainEntryContribution,
  RobotPointsDomainEntryContribution,
  RobotReagentsDomainEntryContribution,
  UniLabDomainNavigationInitializer,
  UniLabWorkbenchContribution,
  WorkflowDomainEntryContribution
} from './unilab-workbench-contribution'
import {
  DeviceDomainEntryWidget,
  MaterialDomainEntryWidget,
  RobotBenchDomainEntryWidget,
  RobotDebugDomainEntryWidget,
  RobotPointsDomainEntryWidget,
  RobotReagentsDomainEntryWidget,
  WorkflowDomainEntryWidget
} from './unilab-workbench-navigator-widget'
import { UniLabWorkbenchWidget } from './unilab-workbench-widget'
import { WorkbenchViewState } from './workbench-view-state'
import { WorkbenchSessionClientImpl } from './workbench-session-client'
import { WorkbenchPrivateStatePreferenceContribution } from './workbench-private-state-preferences'
import {
  UniLabAgentContribution,
  UniLabAgentNavigationContribution
} from './unilab-agent-contribution'
import { UniLabAgentNavigatorWidget } from './unilab-agent-navigator-widget'
import { UniLabAgentWidget } from './unilab-agent-widget'
import { UniLabBottomPanelContribution } from './unilab-bottom-panel-contribution'
import { UniLabSettingsContribution } from './unilab-settings-contribution'
import { UniLabSettingsWidget } from './unilab-settings-widget'
import '../../src/browser/style/index.css'

export default new ContainerModule((bind) => {
  bind(WorkbenchViewState).toSelf().inSingletonScope()
  bind(WorkbenchPrivateStatePreferenceContribution).toSelf().inSingletonScope()
  bind(PreferenceContribution).toService(
    WorkbenchPrivateStatePreferenceContribution
  )
  bind(WorkbenchSessionClientImpl).toSelf().inSingletonScope()
  bind(WorkbenchSessionClient).toService(WorkbenchSessionClientImpl)
  bind(WorkbenchSessionServer).toDynamicValue(context => {
    const client = context.container.get<WorkbenchSessionClientImpl>(
      WorkbenchSessionClientImpl
    )
    const server = WebSocketConnectionProvider.createProxy<WorkbenchSessionServer>(
      context.container,
      WORKBENCH_SESSION_PATH,
      client
    )
    client.setServer(server)
    return server
  }).inSingletonScope()

  bind(UniLabBottomPanelContribution).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution)
    .toService(UniLabBottomPanelContribution)

  bindViewContribution(bind, UniLabAgentContribution)
  bind(UniLabAgentWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: UniLabAgentWidget.ID,
    createWidget: () => context.container.get(UniLabAgentWidget)
  })).inSingletonScope()

  bindViewContribution(bind, UniLabSettingsContribution)
  bind(FrontendApplicationContribution).toService(UniLabSettingsContribution)
  bind(TabBarToolbarContribution).toService(UniLabSettingsContribution)
  bind(UniLabSettingsWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: UniLabSettingsWidget.ID,
    createWidget: () => context.container.get(UniLabSettingsWidget)
  })).inSingletonScope()

  bindViewContribution(bind, UniLabAgentNavigationContribution)
  bind(UniLabAgentNavigatorWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: UniLabAgentNavigatorWidget.ID,
    createWidget: () => context.container.get(UniLabAgentNavigatorWidget)
  })).inSingletonScope()

  bindViewContribution(bind, UniLabWorkbenchContribution)
  bind(FrontendApplicationContribution)
    .toService(UniLabWorkbenchContribution)
  bind(UniLabWorkbenchWidget).toSelf()
  bind(WidgetFactory).toDynamicValue((context) => ({
    id: UniLabWorkbenchWidget.ID,
    createWidget: () => context.container.get(UniLabWorkbenchWidget)
  })).inSingletonScope()

  bindViewContribution(bind, WorkflowDomainEntryContribution)
  bind(WorkflowDomainEntryWidget).toSelf()
  bind(WidgetFactory).toDynamicValue((context) => ({
    id: WorkflowDomainEntryWidget.ID,
    createWidget: () => context.container.get(WorkflowDomainEntryWidget)
  })).inSingletonScope()

  bindViewContribution(bind, MaterialDomainEntryContribution)
  bind(MaterialDomainEntryWidget).toSelf()
  bind(WidgetFactory).toDynamicValue((context) => ({
    id: MaterialDomainEntryWidget.ID,
    createWidget: () => context.container.get(MaterialDomainEntryWidget)
  })).inSingletonScope()

  bindViewContribution(bind, DeviceDomainEntryContribution)
  bind(DeviceDomainEntryWidget).toSelf()
  bind(WidgetFactory).toDynamicValue((context) => ({
    id: DeviceDomainEntryWidget.ID,
    createWidget: () => context.container.get(DeviceDomainEntryWidget)
  })).inSingletonScope()

  bindViewContribution(bind, RobotDebugDomainEntryContribution)
  bind(RobotDebugDomainEntryWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: RobotDebugDomainEntryWidget.ID,
    createWidget: () => context.container.get(RobotDebugDomainEntryWidget)
  })).inSingletonScope()

  bindViewContribution(bind, RobotPointsDomainEntryContribution)
  bind(RobotPointsDomainEntryWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: RobotPointsDomainEntryWidget.ID,
    createWidget: () => context.container.get(RobotPointsDomainEntryWidget)
  })).inSingletonScope()

  bindViewContribution(bind, RobotBenchDomainEntryContribution)
  bind(RobotBenchDomainEntryWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: RobotBenchDomainEntryWidget.ID,
    createWidget: () => context.container.get(RobotBenchDomainEntryWidget)
  })).inSingletonScope()

  bindViewContribution(bind, RobotReagentsDomainEntryContribution)
  bind(RobotReagentsDomainEntryWidget).toSelf()
  bind(WidgetFactory).toDynamicValue(context => ({
    id: RobotReagentsDomainEntryWidget.ID,
    createWidget: () => context.container.get(RobotReagentsDomainEntryWidget)
  })).inSingletonScope()

  bind(UniLabDomainNavigationInitializer).toSelf().inSingletonScope()
  bind(FrontendApplicationContribution)
    .toService(UniLabDomainNavigationInitializer)
})
