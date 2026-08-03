import { randomUUID } from 'node:crypto'

import type { BrowserWindow } from 'electron'
import type {
  DeviceCardAuthoringTarget,
  DeviceCardAuthoringTargetRequest,
  DeviceCardAuthoringTargetResponse
} from '@unilab/device-card-sdk'
import type { DeviceCardAuthoringTargetPort } from '@unilab/device-card-host'

interface PendingTargetRequest {
  resolve: (targets: DeviceCardAuthoringTarget[]) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
export class RendererDeviceCardAuthoringTargetPort
implements DeviceCardAuthoringTargetPort {
  private readonly pending = new Map<string, PendingTargetRequest>()

  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  listTargets(): Promise<DeviceCardAuthoringTarget[]> {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed()) {
      return Promise.reject(new Error('Electron 主窗口不可用。'))
    }
    const request: DeviceCardAuthoringTargetRequest = {
      requestId: randomUUID()
    }
    return new Promise<DeviceCardAuthoringTarget[]>((resolveTargets, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.requestId)
        reject(new Error('等待 Renderer 读取 OS 设备目录超时。'))
      }, 15_000)
      this.pending.set(request.requestId, {
        resolve: resolveTargets,
        reject,
        timer
      })
      window.webContents.send('device-cards:authoringTargetRequest', request)
    })
  }

  resolve(response: DeviceCardAuthoringTargetResponse): void {
    const pending = this.pending.get(response.requestId)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(response.requestId)
    if (response.ok) {
      pending.resolve(response.targets.map((target) => structuredClone(target)))
    } else {
      pending.reject(new Error(response.message))
    }
  }

  destroy(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Electron 正在关闭。'))
    }
    this.pending.clear()
  }
}
