export const EXPLORER_ID = 'explorer-view-container'
export const FILES_PANEL_SIZE = 460
export const LEFT_PANEL_ID = 'theia-left-content-panel'
/** 源码贴着左侧文件树打开，工作流调试放在右侧，避免插在目录和代码中间。 */
export const FILES_EDITOR_SPLIT_MODE = 'split-left'

/** 判断 Theia 左侧内容栏是否已被活动栏二次点击收起。 */
export function isLeftContentPanelCollapsed(panel: Element | null): boolean {
  return panel?.classList.contains('theia-mod-collapsed') ?? false
}

/**
 * 二次点击「文件」会收起左栏，但产品态可能仍标记文件可见。
 * 只有左栏真正展开时，才保留 460px 文件占位。
 */
export function shouldKeepFilesLayout(
  filesVisible: boolean,
  leftCollapsed: boolean
): boolean {
  return filesVisible && !leftCollapsed
}

/**
 * 编辑器与工作流调试叠在同一组，或已经落在其右侧时，需要重新分到文件树一侧。
 */
export function shouldMoveEditorBesideExplorer(input: {
  sameTabBar: boolean
  editorLeft: number
  workbenchLeft: number
}): boolean {
  return input.sameTabBar || input.editorLeft > input.workbenchLeft + 1
}
