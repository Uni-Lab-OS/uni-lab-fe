import { describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn()
}))

vi.mock('electron', () => ({
  dialog: { showOpenDialog: electron.showOpenDialog }
}))

import { registerDeviceProvisioningIpc } from './deviceProvisioningIpc'

type InvokeHandler = (event: unknown, payload?: unknown) => unknown

/** 验证设备接入 IPC 的版本握手和显式接管意图不会在 Main 边界丢失。 */
describe('Electron Main 设备接入 IPC', () => {
  /** 证明 Renderer 可先确认 Main 支持接管，且 configure 保留严格布尔值。 */
  it('公布 v2 能力并传递接管意图', async () => {
    const handlers = new Map<string, InvokeHandler>()
    /** @param input IPC 已校验的配置意图。@returns 原样返回以便测试观测。 */
    const configurePort = async (input: unknown): Promise<unknown> => input
    const configure = vi.fn(configurePort)
    const assertSender = vi.fn()
    const ipcMain = {
      /**
       * @param channel Main 注册的稳定 IPC 通道。
       * @param handler 对应通道的调用处理器。
       * @returns 无返回值；处理器被保存供用例调用。
       */
      handle: (channel: string, handler: InvokeHandler): void => {
        handlers.set(channel, handler)
      }
    }

    /** @returns 本测试不打开路径对话框，因此不提供主窗口。 */
    const getMainWindow = (): null => null

    registerDeviceProvisioningIpc({
      ipcMain: ipcMain as never,
      manager: { configure } as never,
      getMainWindow,
      assertSender
    })

    const contractHandler = handlers.get('device-provisioning:contract')
    expect(contractHandler).toBeTypeOf('function')
    expect(contractHandler?.({ sender: 'renderer' })).toEqual({
      schemaVersion: 'device-provisioning-ipc/v2',
      features: { adoptExisting: true }
    })

    const configureHandler = handlers.get('device-provisioning:configure')
    await configureHandler?.({ sender: 'renderer' }, {
      provisioningId: 'provisioning-1',
      instanceId: 'szlab_s08_cap_station',
      displayName: 'SZLab S08 压盖工位',
      adoptExisting: true,
      configuration: { auto_connect: true }
    })

    expect(configure).toHaveBeenCalledWith(expect.objectContaining({
      adoptExisting: true
    }))
    expect(assertSender).toHaveBeenCalledTimes(2)
  })
})
