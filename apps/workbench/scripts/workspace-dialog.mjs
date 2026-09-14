/**
 * Show the Workspace chooser as a modal child of the active Workbench window.
 *
 * An unparented macOS open panel can remain behind the welcome page while its
 * Promise keeps the serialized Workspace controller queue occupied. Parenting
 * the panel keeps it visible and prevents the welcome renderer from starting a
 * second operation until the user accepts or cancels the chooser.
 *
 * @param {{
 *   dialog: { showOpenDialog: (...args: any[]) => Promise<any> },
 *   BrowserWindow: { getAllWindows: () => Array<{ isDestroyed: () => boolean }> },
 *   kind: 'open' | 'create'
 * }} options
 */
export function showWorkspaceDirectoryDialog({
  dialog,
  BrowserWindow,
  kind
}) {
  const chooserOptions = {
    title: kind === 'create' ? '新建 UniLab 工作区' : '打开 UniLab 工作区',
    buttonLabel: kind === 'create' ? '创建并打开' : '打开',
    properties: kind === 'create'
      ? ['openDirectory', 'createDirectory', 'promptToCreate']
      : ['openDirectory', 'createDirectory']
  }
  const owner = BrowserWindow.getAllWindows().find(
    window => !window.isDestroyed()
  )
  return owner
    ? dialog.showOpenDialog(owner, chooserOptions)
    : dialog.showOpenDialog(chooserOptions)
}
