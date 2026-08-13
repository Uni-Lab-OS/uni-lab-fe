import {
  AbstractViewContribution,
  FrontendApplication,
  FrontendApplicationContribution
} from '@theia/core/lib/browser'
import { Command } from '@theia/core/lib/common/command'
import { inject, injectable } from '@theia/core/shared/inversify'
import type { IDisposable } from '@theia/monaco-editor-core'

import { registerPythonSyntaxHighlighting } from './python-monarch'
import {
  DeviceDomainEntryWidget,
  MaterialDomainEntryWidget,
  WorkflowDomainEntryWidget
} from './unilab-workbench-navigator-widget'
import { UniLabWorkbenchWidget } from './unilab-workbench-widget'
import { UniLabAgentNavigationContribution } from './unilab-agent-contribution'

export const OpenUniLabWorkbench: Command = {
  id: 'unilab.authoring-workbench.open',
  label: '打开 Unilab 调试工作台'
}

export const OpenUniLabWorkflowView: Command = {
  id: 'unilab.workbench.workflow.open',
  label: '打开工作流'
}

export const OpenUniLabMaterialView: Command = {
  id: 'unilab.workbench.material.open',
  label: '打开物料'
}

export const OpenUniLabDeviceView: Command = {
  id: 'unilab.workbench.device-management.open',
  label: '打开仪器设备'
}

@injectable()
export class UniLabWorkbenchContribution
  extends AbstractViewContribution<UniLabWorkbenchWidget>
  implements FrontendApplicationContribution {
  protected pythonSyntaxHighlighting: IDisposable | undefined

  constructor() {
    super({
      widgetId: UniLabWorkbenchWidget.ID,
      widgetName: UniLabWorkbenchWidget.LABEL,
      defaultWidgetOptions: { area: 'main' },
      toggleCommandId: OpenUniLabWorkbench.id
    })
  }

  onStart(_app: FrontendApplication): void {
    this.pythonSyntaxHighlighting = registerPythonSyntaxHighlighting()
    void this.openView({ activate: true, reveal: true })
  }

  onStop(_app: FrontendApplication): void {
    this.pythonSyntaxHighlighting?.dispose()
    this.pythonSyntaxHighlighting = undefined
  }
}

@injectable()
export class WorkflowDomainEntryContribution
  extends AbstractViewContribution<WorkflowDomainEntryWidget> {
  constructor() {
    super({
      widgetId: WorkflowDomainEntryWidget.ID,
      widgetName: '工作流',
      defaultWidgetOptions: { area: 'left', rank: 73 },
      toggleCommandId: OpenUniLabWorkflowView.id
    })
  }
}

@injectable()
export class MaterialDomainEntryContribution
  extends AbstractViewContribution<MaterialDomainEntryWidget> {
  constructor() {
    super({
      widgetId: MaterialDomainEntryWidget.ID,
      widgetName: '物料',
      defaultWidgetOptions: { area: 'left', rank: 72 },
      toggleCommandId: OpenUniLabMaterialView.id
    })
  }
}

@injectable()
export class DeviceDomainEntryContribution
  extends AbstractViewContribution<DeviceDomainEntryWidget> {
  constructor() {
    super({
      widgetId: DeviceDomainEntryWidget.ID,
      widgetName: '仪器设备',
      defaultWidgetOptions: { area: 'left', rank: 71 },
      toggleCommandId: OpenUniLabDeviceView.id
    })
  }
}

@injectable()
export class UniLabDomainNavigationInitializer
implements FrontendApplicationContribution {
  @inject(WorkflowDomainEntryContribution)
  protected readonly workflow!: WorkflowDomainEntryContribution

  @inject(MaterialDomainEntryContribution)
  protected readonly material!: MaterialDomainEntryContribution

  @inject(DeviceDomainEntryContribution)
  protected readonly device!: DeviceDomainEntryContribution

  @inject(UniLabAgentNavigationContribution)
  protected readonly agent!: UniLabAgentNavigationContribution

  async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
    const device = await this.device.openView({ activate: false, reveal: false })
    const material = await this.material.openView({
      activate: false,
      reveal: false
    })
    const workflow = await this.workflow.openView({
      activate: false,
      reveal: false
    })
    const agent = await this.agent.openView({ activate: false, reveal: false })

    // Ranks govern fresh widgets, while Theia restores persisted titles in their
    // saved order before contributions run. Re-add to restore each rank, then
    // normalize the public tab bar so upgrades cannot retain an obsolete order.
    await app.shell.addWidget(device, { area: 'left', rank: 71 })
    await app.shell.addWidget(material, { area: 'left', rank: 72 })
    await app.shell.addWidget(workflow, { area: 'left', rank: 73 })
    await app.shell.addWidget(agent, { area: 'left', rank: 74 })
    const activityBar = app.shell.getTabBarFor(device)
    for (const [index, widget] of [
      device,
      material,
      workflow,
      agent
    ].entries()) {
      activityBar?.insertTab(index, widget.title)
    }
    await app.shell.collapsePanel('left')
  }
}
