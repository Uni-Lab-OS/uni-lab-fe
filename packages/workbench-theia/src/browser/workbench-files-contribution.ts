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
import {
  EXPLORER_ID,
  FILES_EDITOR_SPLIT_MODE,
  FILES_PANEL_SIZE,
  LEFT_PANEL_ID,
  isLeftContentPanelCollapsed,
  shouldKeepFilesLayout,
  shouldMoveEditorBesideExplorer
} from './workbench-files-layout'
import { WorkbenchViewState } from './workbench-view-state'

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
  private collapseObserver: MutationObserver | undefined
  private arranging = false

  /** 文件树和产品导航共用左侧面板，恢复布局时也要重新应用文件树宽度。 */
  private resizeFilesPanel(): void {
    if (!this.shouldPresentFiles()) return
    this.shell.resize(FILES_PANEL_SIZE, 'left')
  }

  private leftPanel(): HTMLElement | null {
    return document.getElementById(LEFT_PANEL_ID)
  }

  private isLeftCollapsed(): boolean {
    return isLeftContentPanelCollapsed(this.leftPanel())
  }

  private shouldPresentFiles(): boolean {
    return shouldKeepFilesLayout(this.viewState.isVisible('files'), this.isLeftCollapsed())
  }

  /** 活动栏再次点击「文件」会收起左栏；产品态必须同时关掉文件占位。 */
  private syncFilesWithLeftPanel(): void {
    if (this.isLeftCollapsed() && this.viewState.isVisible('files')) {
      this.viewState.toggle('files')
    }
  }

  private clearFilesLayoutReservation(): void {
    document.body.classList.remove('unilab-files-visible')
    document.body.style.removeProperty('--unilab-files-left-width')
  }

  onStart(): void {
    this.subscriptions.push(this.viewState.onDidChangeMode(() => this.present(true)))
    this.subscriptions.push(this.shell.onDidChangeActiveWidget(({ newValue }) => {
      if (this.applicationState.state !== 'ready') return
      if (newValue?.id === EXPLORER_ID || newValue?.id === 'files') {
        if (this.isLeftCollapsed()) {
          if (this.viewState.isVisible('files')) {
            this.syncFilesWithLeftPanel()
            this.present()
          }
          return
        }
        if (!this.viewState.isVisible('files')) this.viewState.toggle('files')
        this.present()
        return
      }
      if (newValue instanceof EditorWidget) {
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
      if (tabBar.currentTitle?.owner.id !== EXPLORER_ID) return
      if (this.isLeftCollapsed()) {
        if (this.viewState.isVisible('files')) {
          this.syncFilesWithLeftPanel()
          this.present()
        }
        return
      }
      if (!this.viewState.isVisible('files')) this.viewState.toggle('files')
      // 产品活动栏宽于 Theia 默认活动栏，给文件树留出可读的独立宽度。
      this.resizeFilesPanel()
      this.present()
    }
    tabBar.currentChanged.connect(selectFiles)
    this.subscriptions.push({ dispose: () => tabBar.currentChanged.disconnect(selectFiles) })
    const leftPanel = this.leftPanel()
    if (leftPanel) {
      this.observer = new ResizeObserver(() => {
        if (!this.shouldPresentFiles()) {
          this.clearFilesLayoutReservation()
          this.shell.mainPanel.update()
          return
        }
        document.body.style.setProperty(
          '--unilab-files-left-width', `${leftPanel.getBoundingClientRect().width}px`
        )
        this.shell.mainPanel.update()
      })
      this.observer.observe(leftPanel)
      this.collapseObserver = new MutationObserver(() => {
        if (this.isLeftCollapsed()) {
          this.syncFilesWithLeftPanel()
          return
        }
        if (
          tabBar.currentTitle?.owner.id === EXPLORER_ID &&
          !this.viewState.isVisible('files')
        ) {
          this.viewState.toggle('files')
        }
      })
      this.collapseObserver.observe(leftPanel, {
        attributes: true,
        attributeFilter: ['class']
      })
    }
    this.present()
    void this.applicationState.reachedState('ready').then(() => {
      // 布局恢复时 currentChanged 可能不会再次触发，主动修正已打开的文件树宽度。
      this.resizeFilesPanel()
      if (this.viewState.isVisible('files')) {
        void this.shell.revealWidget(EXPLORER_ID).then(() => {
          this.resizeFilesPanel()
          this.present(true)
        })
      }
    })
  }

  /** 切换仅影响展示，不关闭文件或丢弃尚未保存的编辑内容。 */
  private present(activateFile = false): void {
    const filesVisible = this.viewState.isVisible('files')
    document.body.dataset.unilabView = this.viewState.currentMode
    document.body.classList.toggle('unilab-files-visible', filesVisible)
    if (!filesVisible) this.clearFilesLayoutReservation()
    if (this.arranging) return
    this.arranging = true
    queueMicrotask(() => {
      try {
        const workbench = this.shell.getWidgetById(UniLabWorkbenchWidget.ID)
        if (!this.viewState.isVisible('files')) {
          this.clearFilesLayoutReservation()
          void this.shell.collapsePanel('left')
          workbench?.show()
          this.shell.mainPanel.update()
          return
        }
        const editor = this.editors.currentEditor ?? this.editors.all.at(-1)
        if (this.shell.leftPanelHandler.tabBar.currentTitle?.owner.id !== EXPLORER_ID) {
          void this.shell.revealWidget(EXPLORER_ID).then(() => this.resizeFilesPanel())
        } else {
          this.resizeFilesPanel()
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
          } else if (shouldMoveEditorBesideExplorer({
            sameTabBar: this.shell.getTabBarFor(editor) ===
              this.shell.getTabBarFor(workbench),
            editorLeft: editor.node.getBoundingClientRect().left,
            workbenchLeft: workbench.node.getBoundingClientRect().left
          })) {
            // 源码紧挨左侧文件树，工作流调试放右侧；保持代码编辑器唯一实例。
            void this.shell.addWidget(editor, {
              area: 'main',
              mode: FILES_EDITOR_SPLIT_MODE,
              ref: workbench
            })
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
    this.collapseObserver?.disconnect()
    delete document.body.dataset.unilabView
    this.clearFilesLayoutReservation()
  }
}
