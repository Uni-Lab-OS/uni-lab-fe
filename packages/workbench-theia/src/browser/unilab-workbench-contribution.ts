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
  RobotBenchDomainEntryWidget,
  RobotDebugDomainEntryWidget,
  RobotPointsDomainEntryWidget,
  RobotReagentsDomainEntryWidget,
  WorkflowDomainEntryWidget,
  WorkflowTasksDomainEntryWidget
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

export const OpenUniLabWorkflowTasksView: Command = {
  id: 'unilab.workbench.workflow-tasks.open',
  label: '打开任务列表'
}

export const OpenUniLabMaterialView: Command = {
  id: 'unilab.workbench.material.open',
  label: '打开物料'
}

export const OpenUniLabDeviceView: Command = {
  id: 'unilab.workbench.device-management.open',
  label: '打开仪器设备'
}

export const OpenRobotDebugView: Command = {
  id: 'unilab.workbench.robot-debug.open',
  label: '打开设备动作'
}

export const OpenRobotPointsView: Command = {
  id: 'unilab.workbench.robot-points.open',
  label: '打开机械臂点位管理'
}

export const OpenRobotBenchView: Command = {
  id: 'unilab.workbench.robot-bench.open',
  label: '打开工作流管理'
}

export const OpenRobotReagentsView: Command = {
  id: 'unilab.workbench.robot-reagents.open',
  label: '打开试剂'
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
      widgetName: '工作',
      defaultWidgetOptions: { area: 'left', rank: 72 },
      toggleCommandId: OpenUniLabWorkflowView.id
    })
  }
}

@injectable()
export class WorkflowTasksDomainEntryContribution
  extends AbstractViewContribution<WorkflowTasksDomainEntryWidget> {
  constructor() {
    super({
      widgetId: WorkflowTasksDomainEntryWidget.ID,
      widgetName: '任务列表',
      defaultWidgetOptions: { area: 'left', rank: 78 },
      toggleCommandId: OpenUniLabWorkflowTasksView.id
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
      defaultWidgetOptions: { area: 'left', rank: 75 },
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
      widgetName: '设备管理',
      defaultWidgetOptions: { area: 'left', rank: 73 },
      toggleCommandId: OpenUniLabDeviceView.id
    })
  }
}

@injectable()
export class RobotDebugDomainEntryContribution
  extends AbstractViewContribution<RobotDebugDomainEntryWidget> {
  constructor() {
    super({
      widgetId: RobotDebugDomainEntryWidget.ID,
      widgetName: '设备动作',
      defaultWidgetOptions: { area: 'left', rank: 71 },
      toggleCommandId: OpenRobotDebugView.id
    })
  }
}

@injectable()
export class RobotPointsDomainEntryContribution
  extends AbstractViewContribution<RobotPointsDomainEntryWidget> {
  constructor() {
    super({
      widgetId: RobotPointsDomainEntryWidget.ID,
      widgetName: '实验操作调试',
      defaultWidgetOptions: { area: 'left', rank: 73 },
      toggleCommandId: OpenRobotPointsView.id
    })
  }
}

@injectable()
export class RobotBenchDomainEntryContribution
  extends AbstractViewContribution<RobotBenchDomainEntryWidget> {
  constructor() {
    super({
      widgetId: RobotBenchDomainEntryWidget.ID,
      widgetName: '工作流管理',
      defaultWidgetOptions: { area: 'left', rank: 74 },
      toggleCommandId: OpenRobotBenchView.id
    })
  }
}

@injectable()
export class RobotReagentsDomainEntryContribution
  extends AbstractViewContribution<RobotReagentsDomainEntryWidget> {
  constructor() {
    super({
      widgetId: RobotReagentsDomainEntryWidget.ID,
      widgetName: '试剂',
      defaultWidgetOptions: { area: 'left', rank: 74 },
      toggleCommandId: OpenRobotReagentsView.id
    })
  }
}

@injectable()
export class UniLabDomainNavigationInitializer
implements FrontendApplicationContribution {
  @inject(WorkflowDomainEntryContribution)
  protected readonly workflow!: WorkflowDomainEntryContribution

  @inject(WorkflowTasksDomainEntryContribution)
  protected readonly workflowTasks!: WorkflowTasksDomainEntryContribution

  @inject(MaterialDomainEntryContribution)
  protected readonly material!: MaterialDomainEntryContribution

  @inject(RobotDebugDomainEntryContribution)
  protected readonly robotDebug!: RobotDebugDomainEntryContribution

  @inject(RobotPointsDomainEntryContribution)
  protected readonly robotPoints!: RobotPointsDomainEntryContribution

  @inject(RobotBenchDomainEntryContribution)
  protected readonly robotBench!: RobotBenchDomainEntryContribution

  @inject(RobotReagentsDomainEntryContribution)
  protected readonly robotReagents!: RobotReagentsDomainEntryContribution

  @inject(DeviceDomainEntryContribution)
  protected readonly device!: DeviceDomainEntryContribution

  @inject(UniLabAgentNavigationContribution)
  protected readonly agent!: UniLabAgentNavigationContribution

  /**
   * 初始化 Workbench 左侧活动栏的领域入口，并收起仅用于切换的内容面板。
   * @param app Theia 前端应用，用于按固定顺序挂载各领域入口。
   * @returns 所有入口完成挂载、排序与面板收起后结束。
   */
  async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
    const device = await this.device.openView({ activate: false, reveal: false })
    const robotDebug = await this.robotDebug.openView({
      activate: false,
      reveal: false
    })
    const robotPoints = await this.robotPoints.openView({
      activate: false,
      reveal: false
    })
    const robotBench = await this.robotBench.openView({
      activate: false,
      reveal: false
    })
    const robotReagents = await this.robotReagents.openView({
      activate: false,
      reveal: false
    })
    const material = await this.material.openView({
      activate: false,
      reveal: false
    })
    const workflow = await this.workflow.openView({
      activate: false,
      reveal: false
    })
    const workflowTasks = await this.workflowTasks.openView({
      activate: false,
      reveal: false
    })
    const agent = await this.agent.openView({ activate: false, reveal: false })

    // rank 只影响新建部件；Theia 会先恢复持久化顺序，因此这里重新挂载并
    // 规范公开活动栏的顺序，避免升级后继续沿用已经过时的排列。
    await app.shell.addWidget(robotDebug, { area: 'left', rank: 71 })
    await app.shell.addWidget(robotPoints, { area: 'left', rank: 72 })
    await app.shell.addWidget(workflow, { area: 'left', rank: 73 })
    await app.shell.addWidget(device, { area: 'left', rank: 74 })
    await app.shell.addWidget(robotReagents, { area: 'left', rank: 75 })
    await app.shell.addWidget(material, { area: 'left', rank: 76 })
    await app.shell.addWidget(robotBench, { area: 'left', rank: 77 })
    await app.shell.addWidget(workflowTasks, { area: 'left', rank: 78 })
    await app.shell.addWidget(agent, { area: 'left', rank: 79 })
    const activityBar = app.shell.getTabBarFor(device)
    for (const [index, widget] of [
      robotDebug,
      robotPoints,
      workflow,
      device,
      robotReagents,
      material,
      robotBench,
      workflowTasks,
      agent
    ].entries()) {
      activityBar?.insertTab(index, widget.title)
    }
    await app.shell.collapsePanel('left')
    await app.shell.collapsePanel('right')
    globalThis.setTimeout(() => {
      // 只清理由布局恢复产生的右栏，不能覆盖用户刚刚打开的 Agent。
      if (!document.body.classList.contains('unilab-agent-panel-visible')) {
        void app.shell.collapsePanel('right')
      }
    }, 100)
  }
}
