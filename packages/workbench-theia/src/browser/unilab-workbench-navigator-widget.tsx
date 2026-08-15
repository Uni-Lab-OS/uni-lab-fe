import { ApplicationShell, Message } from '@theia/core/lib/browser'
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from 'react'

import {
  DomainEntryPanel,
  type DomainEntryDefinition
} from './domain-entry-panel'
import { UniLabWorkbenchWidget } from './unilab-workbench-widget'
import { WorkbenchViewState } from './workbench-view-state'

abstract class UniLabDomainEntryWidget extends ReactWidget {
  @inject(WorkbenchViewState)
  protected readonly viewState!: WorkbenchViewState

  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell

  protected abstract readonly entry: DomainEntryDefinition
  protected abstract readonly widgetId: string

  @postConstruct()
  protected init(): void {
    this.id = this.widgetId
    this.title.label = this.entry.label
    this.title.caption = this.entry.caption
    this.title.iconClass = `unilab-activity-icon ${this.entry.iconClass}`
    this.title.closable = false
    this.node.style.minWidth = '196px'
    this.toDispose.push(this.viewState.onDidChangeMode(() => {
      this.updateActivityPresentation()
      this.update()
    }))
    this.updateActivityPresentation()
    this.update()
  }

  protected readonly open = (): void => {
    this.viewState.toggle(this.entry.mode)
    void this.shell.collapsePanel('left')
    void this.shell.activateWidget(UniLabWorkbenchWidget.ID)
  }

  protected updateActivityPresentation(): void {
    const active = this.viewState.isVisible(this.entry.mode)
    this.title.dataset = {
      unilabGroup: 'true',
      unilabDomain: this.entry.mode,
      unilabActive: String(active)
    }
    this.title.className = `unilab-workbench-activity${
      active ? ' is-domain-active' : ''
    }`
  }

  protected override render(): React.ReactElement {
    return (
      <DomainEntryPanel
        entry={this.entry}
        active={this.viewState.isVisible(this.entry.mode)}
        onOpen={this.open}
      />
    )
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    this.open()
  }
}

@injectable()
export class WorkflowDomainEntryWidget extends UniLabDomainEntryWidget {
  static readonly ID = 'unilab:workbench-navigator'
  protected readonly widgetId = WorkflowDomainEntryWidget.ID
  protected readonly entry: DomainEntryDefinition = {
    mode: 'workflow',
    label: '工作',
    caption: '工作流 · 代码、画布与运行',
    description: '编辑工作流源码、观察 DAG，并与 IDE 代码位置双向联动。',
    iconClass: 'unilab-activity-icon--workflow',
    eyebrow: 'WORKFLOW'
  }
}

@injectable()
export class MaterialDomainEntryWidget extends UniLabDomainEntryWidget {
  static readonly ID = 'unilab:material-navigation'
  protected readonly widgetId = MaterialDomainEntryWidget.ID
  protected readonly entry: DomainEntryDefinition = {
    mode: 'material',
    label: '物料',
    caption: '物料 · 列表、空间与转运',
    description: '查看物料、库位与转运路径，并保持与工作流节点同步。',
    iconClass: 'unilab-activity-icon--material',
    eyebrow: 'MATERIAL'
  }
}

@injectable()
export class DeviceDomainEntryWidget extends UniLabDomainEntryWidget {
  static readonly ID = 'unilab:device-management-navigation'
  protected readonly widgetId = DeviceDomainEntryWidget.ID
  protected readonly entry: DomainEntryDefinition = {
    mode: 'device',
    label: '设备',
    caption: '仪器设备 · 目录、参数与单动作运行',
    description: '读取当前运行连接的设备动作，填写参数并运行单动作调试任务。',
    iconClass: 'unilab-activity-icon--device',
    eyebrow: 'INSTRUMENTS'
  }
}

@injectable()
export class RobotDebugDomainEntryWidget extends UniLabDomainEntryWidget {
  static readonly ID = 'unilab:robot-debug-navigation'
  protected readonly widgetId = RobotDebugDomainEntryWidget.ID
  protected readonly entry: DomainEntryDefinition = {
    mode: 'robot-debug',
    label: '动作调试',
    caption: '动作调试 · 真实设备与单动作运行',
    description: '读取当前运行连接的机械臂动作，并通过统一任务接口运行单动作调试。',
    iconClass: 'unilab-activity-icon--robot-debug',
    eyebrow: 'ROBOT DEBUG'
  }
}

@injectable()
export class RobotPointsDomainEntryWidget extends UniLabDomainEntryWidget {
  static readonly ID = 'unilab:robot-points-navigation'
  protected readonly widgetId = RobotPointsDomainEntryWidget.ID
  protected readonly entry: DomainEntryDefinition = {
    mode: 'robot-points',
    label: '点位管理',
    caption: '点位管理 · 机械臂控制点目录',
    description: '读取后端发布的机械臂控制点；接口缺失时保持失败关闭。',
    iconClass: 'unilab-activity-icon--robot-points',
    eyebrow: 'ROBOT POINTS'
  }
}

@injectable()
export class RobotBenchDomainEntryWidget extends UniLabDomainEntryWidget {
  static readonly ID = 'unilab:robot-bench-navigation'
  protected readonly widgetId = RobotBenchDomainEntryWidget.ID
  protected readonly entry: DomainEntryDefinition = {
    mode: 'robot-bench',
    label: '实验台',
    caption: '实验台 · 库位与物料占用',
    description: '从公共物料图查看实验台库位和真实逻辑占用关系。',
    iconClass: 'unilab-activity-icon--robot-bench',
    eyebrow: 'LAB BENCH'
  }
}

@injectable()
export class RobotReagentsDomainEntryWidget extends UniLabDomainEntryWidget {
  static readonly ID = 'unilab:robot-reagents-navigation'
  protected readonly widgetId = RobotReagentsDomainEntryWidget.ID
  protected readonly entry: DomainEntryDefinition = {
    mode: 'robot-reagents',
    label: '试剂管理',
    caption: '试剂管理 · 容器与库存批次',
    description: '读取后端真实试剂容器或 OS 库存批次，不维护前端本地台账。',
    iconClass: 'unilab-activity-icon--robot-reagents',
    eyebrow: 'REAGENTS'
  }
}
