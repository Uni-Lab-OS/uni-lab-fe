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

  /**
   * 在真实主工作区显示当前领域，并立即收起仅承担导航职责的 Theia 侧栏。
   *
   * @returns 无返回值；侧栏收起和主工作区聚焦由 ApplicationShell 异步完成。
   */
  readonly openInWorkbench = (): void => {
    this.viewState.show(this.entry.mode)
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
        onOpen={this.openInWorkbench}
      />
    )
  }

  protected override onActivateRequest(message: Message): void {
    super.onActivateRequest(message)
    this.openInWorkbench()
  }
}

@injectable()
export class WorkflowDomainEntryWidget extends UniLabDomainEntryWidget {
  static readonly ID = 'unilab:workbench-navigator'
  protected readonly widgetId = WorkflowDomainEntryWidget.ID
  protected readonly entry: DomainEntryDefinition = {
    mode: 'workflow',
    label: '工作流',
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
    label: '仪器设备',
    caption: '仪器设备 · 目录、参数与单动作运行',
    description: '读取 OS 上报的设备动作，填写参数并运行单动作调试任务。',
    iconClass: 'unilab-activity-icon--device',
    eyebrow: 'INSTRUMENTS'
  }
}
