import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('api', {
  workbenchWorkspace: {
    getSnapshot: () => ipcRenderer.invoke('workbench-workspace:getSnapshot'),
    openDirectory: () => ipcRenderer.invoke('workbench-workspace:openDirectory'),
    createDirectory: () => ipcRenderer.invoke('workbench-workspace:createDirectory'),
    openRecent: (path: string) => ipcRenderer.invoke(
      'workbench-workspace:openRecent',
      path
    ),
    selectDirectory: () => ipcRenderer.invoke(
      'workbench-workspace:selectDirectory'
    ),
    switchToWelcome: () => ipcRenderer.invoke(
      'workbench-workspace:switchToWelcome'
    ),
    onSnapshot: (listener: (snapshot: unknown) => void) => {
      const wrapped = (_event: unknown, snapshot: unknown): void => {
        listener(snapshot)
      }
      ipcRenderer.on('workbench-workspace:snapshot', wrapped)
      return () => ipcRenderer.removeListener(
        'workbench-workspace:snapshot',
        wrapped
      )
    }
  }
})
