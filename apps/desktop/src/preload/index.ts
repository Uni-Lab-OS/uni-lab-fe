import { contextBridge, ipcRenderer } from 'electron'
import type {
  DeviceCardActionRun,
  DeviceCardBounds,
  DeviceCardHostActionRequest,
  InstalledDeviceCard,
  OpenDeviceCardRequest
} from '@unilab/device-card-sdk'

// 登录会话结构(与主进程 authManager.AuthSession 保持一致)
export interface AuthUserInfo {
  name?: string
  email?: string
  userId?: string
}

export interface AuthSession {
  token: string
  userInfo: AuthUserInfo | null
  loggedInAt: number
}

// 本地文件读写结果
export interface OpenedFile {
  path: string
  content: string
}

export interface SavedFile {
  path: string
}

export interface SaveFilePayload {
  path: string | null
  content: string
  defaultName?: string
}

export interface SaveBinaryFilePayload {
  content: Uint8Array
  defaultName?: string
}

// 打开文件的入参:accept 指定对话框过滤的文件类型,缺省为 JSON
export interface OpenFilePayload {
  accept?: 'json' | 'python'
}

const api = {
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  auth: {
    // 读取本地已保存的登录会话
    getSession: (): Promise<AuthSession | null> => ipcRenderer.invoke('auth:getSession'),
    // 发起 Bohrium OAuth 登录,成功返回会话,取消返回 null
    login: (): Promise<AuthSession | null> => ipcRenderer.invoke('auth:login'),
    // 登出并清除本地会话
    logout: (): Promise<boolean> => ipcRenderer.invoke('auth:logout')
  },
  file: {
    // 打开本地文件(accept 指定类型,默认 JSON),取消返回 null
    open: (payload?: OpenFilePayload): Promise<OpenedFile | null> =>
      ipcRenderer.invoke('file:open', payload),
    // 保存文本到本地文件(path 为 null 时弹出"另存为"),取消返回 null
    save: (payload: SaveFilePayload): Promise<SavedFile | null> =>
      ipcRenderer.invoke('file:save', payload),
    // 保存二进制文件，始终弹出"另存为"，避免 renderer 指定任意覆盖路径
    saveBinary: (payload: SaveBinaryFilePayload): Promise<SavedFile | null> =>
      ipcRenderer.invoke('file:saveBinary', payload)
  },
  deviceCards: {
    list: (): Promise<InstalledDeviceCard[]> =>
      ipcRenderer.invoke('device-cards:list'),
    importCard: (): Promise<InstalledDeviceCard | null> =>
      ipcRenderer.invoke('device-cards:import'),
    open: (request: OpenDeviceCardRequest): Promise<void> =>
      ipcRenderer.invoke('device-cards:open', request),
    updateBounds: (bounds: DeviceCardBounds): Promise<void> =>
      ipcRenderer.invoke('device-cards:updateBounds', bounds),
    updateState: (state: Record<string, unknown>): Promise<void> =>
      ipcRenderer.invoke('device-cards:updateState', state),
    close: (): Promise<void> => ipcRenderer.invoke('device-cards:close'),
    resolveAction: (run: DeviceCardActionRun): Promise<void> =>
      ipcRenderer.invoke('device-cards:resolveAction', run),
    onActionRequest: (
      listener: (request: DeviceCardHostActionRequest) => void
    ): (() => void) => {
      const wrapped = (
        _event: Electron.IpcRendererEvent,
        request: DeviceCardHostActionRequest
      ): void => listener(request)
      ipcRenderer.on('device-cards:actionRequest', wrapped)
      return () => ipcRenderer.removeListener(
        'device-cards:actionRequest',
        wrapped
      )
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  ;(globalThis as unknown as { api: Api }).api = api
}

export type Api = typeof api
