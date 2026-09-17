import {
  ApplicationShell,
  type FrontendApplication,
  type FrontendApplicationContribution
} from '@theia/core/lib/browser'
import { FrontendApplicationStateService } from '@theia/core/lib/browser/frontend-application-state'
import { DisposableCollection } from '@theia/core/lib/common/disposable'
import { inject, injectable } from '@theia/core/shared/inversify'
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser'

import { UniLabWorkbenchWidget } from './unilab-workbench-widget'
import { WorkbenchViewState } from './workbench-view-state'

const EXPLORER_ID = 'explorer-view-container'

/** 将原生文件树、编辑器与产品领域视图连接到同一呈现状态。 */
@injectable()
export class WorkbenchFilesContribution implements FrontendApplicationContribution {
  @inject(ApplicationShell)
  protected readonly shell!: ApplicationShell

  @inject(WorkbenchViewState)
  protected readonly viewState!: WorkbenchViewState

  @inject(EditorManager)
  protected readonly editors!: EditorManager

  @inject(FrontendApplicationStateService)
  protected readonly applicationState!: FrontendApplicationStateService

  private readonly subscriptions = new DisposableCollection()
  private observer: ResizeObserver | undefined
  private arranging = false

  onStart(): void {
    this.subscriptions.push(this.viewState.onDidChangeMode(() => this.present(true)))
    this.subscriptions.push(this.shell.onDidChangeActiveWidget(({ newValue }) => {
      if (this.applicationState.state !== 'ready') return
      if (newValue?.id === EXPLORER_ID || newValue?.id === 'files' ||
          newValue instanceof EditorWidget) {
        if (!this.viewState.isVisible('files')) this.viewState.toggle('files')
        this.present()
      }
    }))
    this.subscriptions.push(this.shell.onDidAddWidget(widget => {
      if (widget instanceof EditorWidget) this.present()
    }))
    this.subscriptions.push(this.shell.onDidRemoveWidget(widget => {
      if (widget instanceof EditorWidget) this.present()
    }))
  }

  onDidInitializeLayout(_app: FrontendApplication): void {
    const tabBar = this.shell.leftPanelHandler.tabBar
    const selectFiles = (): void => {
      if (tabBar.currentTitle?.owner.id === EXPLORER_ID) {
        if (!this.viewState.isVisible('files')) this.viewState.toggle('files')
        // 产品活动栏宽于 Theia 默认活动栏，给文件树留出可读的独立宽度。
        this.shell.resize(460, 'left')
        this.present()
      }
    }
    tabBar.currentChanged.connect(selectFiles)
    this.subscriptions.push({ dispose: () => tabBar.currentChanged.disconnect(selectFiles) })
    const leftPanel = document.getElementById('theia-left-content-panel')
    if (leftPanel) {
      this.observer = new ResizeObserver(() => {
        document.body.style.setProperty(
          '--unilab-files-left-width', `${leftPanel.getBoundingClientRect().width}px`
        )
        this.shell.mainPanel.update()
      })
      this.observer.observe(leftPanel)
    }
    this.present()
    void this.applicationState.reachedState('ready').then(() => {
      if (this.viewState.isVisible('files')) {
        void this.shell.revealWidget(EXPLORER_ID)
        this.present(true)
      }
    })
  }

  /** 切换仅影响展示，不关闭文件或丢弃尚未保存的编辑内容。 */
  private present(activateFile = false): void {
    document.body.dataset.unilabView = this.viewState.currentMode
    document.body.classList.toggle('unilab-files-visible', this.viewState.isVisible('files'))
    if (this.arranging) return
    this.arranging = true
    queueMicrotask(() => {
      try {
        const workbench = this.shell.getWidgetById(UniLabWorkbenchWidget.ID)
        const editor = this.editors.currentEditor ?? this.editors.all.at(-1)
        if (this.viewState.isVisible('files') &&
            this.shell.leftPanelHandler.tabBar.currentTitle?.owner.id !== EXPLORER_ID) {
          void this.shell.revealWidget(EXPLORER_ID)
        }
        if (workbench && editor && this.viewState.isVisible('files')) {
          if (this.viewState.currentMode === 'files') {
            if (activateFile) {
              // 从工作流分栏返回文件时，将编辑器收回同一标签组以填满主区。
              for (const openEditor of this.editors.all) {
                if (this.shell.getTabBarFor(openEditor) !== this.shell.getTabBarFor(workbench)) {
                  void this.shell.addWidget(openEditor, { area: 'main', mode: 'tab-after', ref: workbench })
                }
              }
              void this.shell.activateWidget(editor.id)
            }
          } else if (this.shell.getTabBarFor(editor) === this.shell.getTabBarFor(workbench)) {
            // 工作流和源码各自使用原生 Dock 分栏，保持代码编辑器唯一实例。
            void this.shell.addWidget(editor, { area: 'main', mode: 'split-right', ref: workbench })
            for (const openEditor of this.editors.all) {
              if (openEditor !== editor &&
                  this.shell.getTabBarFor(openEditor) === this.shell.getTabBarFor(workbench)) {
                void this.shell.addWidget(openEditor, { area: 'main', mode: 'tab-after', ref: editor })
              }
            }
            void this.shell.revealWidget(editor.id)
            workbench.show()
          } else {
            workbench.show()
            editor.show()
          }
        }
        if (workbench && !editor && this.viewState.currentMode === 'files') {
          void this.shell.activateWidget(workbench.id)
        }
        this.shell.mainPanel.update()
      } finally {
        this.arranging = false
      }
    })
  }

  onStop(): void {
    this.subscriptions.dispose()
    this.observer?.disconnect()
    delete document.body.dataset.unilabView
    document.body.classList.remove('unilab-files-visible')
    document.body.style.removeProperty('--unilab-files-left-width')
  }
}
