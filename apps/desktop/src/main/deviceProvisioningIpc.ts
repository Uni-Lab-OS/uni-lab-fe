import {
  DEVICE_PROVISIONING_IPC_CONTRACT,
  isCloudEnvironment,
  requireRosDeviceInstanceId,
  type CloudEnvironment,
  type ConfigureLocalDeviceProvisioningInput,
  type DevicePackageUploadRequest,
  type DeviceProvisioningPathSelection,
  type StartLocalDeviceProvisioningInput
} from '@unilab/device-provisioning'
import type { DeviceSquareListQuery } from '@unilab/services'

import {
  dialog,
  type BrowserWindow,
  type IpcMain,
  type IpcMainInvokeEvent
} from 'electron'

import type { LocalDeviceProvisioningManager } from './localDeviceProvisioningManager'
import { ApprovedDevicePackagePaths } from './approvedDevicePackagePaths'

interface RegisterDeviceProvisioningIpcOptions {
  ipcMain: IpcMain
  manager: LocalDeviceProvisioningManager
  getMainWindow: () => BrowserWindow | null
  assertSender: (event: IpcMainInvokeEvent) => void
}

/**
 * 注册候选本地设备接入（LocalDeviceProvisioning）的最小可信 IPC 面。
 *
 * @param options Electron IPC、Main 编排器、主窗口解析器与 sender 门禁。
 * @returns 无返回值；所有处理器在注册后保持到应用退出。
 * @safety Renderer 只能提交模板 UUID、接入 UUID、配置值和受控选择器返回路径。
 */
export function registerDeviceProvisioningIpc(
  options: RegisterDeviceProvisioningIpcOptions
): void {
  const { ipcMain, manager, assertSender } = options
  const approvedPaths = new ApprovedDevicePackagePaths()

  /**
   * 向已通过 sender 门禁的 Renderer 公布当前 Main 设备接入能力。
   *
   * @param event Electron 提供的调用来源，用于防止非主渲染器读取合同。
   * @returns 与当前 Main 代码同步发布的版本化能力合同。
   */
  const readContract = (
    event: IpcMainInvokeEvent
  ): typeof DEVICE_PROVISIONING_IPC_CONTRACT => {
    assertSender(event)
    return DEVICE_PROVISIONING_IPC_CONTRACT
  }
  ipcMain.handle('device-provisioning:contract', readContract)
  ipcMain.handle('device-provisioning:square:list', (event, payload: unknown) => {
    assertSender(event)
    const request = parseSquareListRequest(payload)
    return manager.listCloudDevices(request.cloudEnvironment, request.query)
  })
  ipcMain.handle('device-provisioning:square:detail', (event, payload: unknown) => {
    assertSender(event)
    const request = parseCloudTemplateRequest(payload)
    return manager.getCloudDevice(
      request.cloudEnvironment,
      request.templateUuid
    )
  })
  ipcMain.handle('device-provisioning:list', (event) => {
    assertSender(event)
    return manager.list()
  })
  ipcMain.handle('device-provisioning:start', (event, payload: unknown) => {
    assertSender(event)
    return manager.start(parseCloudTemplateRequest(payload))
  })
  ipcMain.handle('device-provisioning:download', (event, payload: unknown) => {
    assertSender(event)
    return manager.downloadOnly(parseCloudTemplateRequest(payload))
  })
  ipcMain.handle('device-provisioning:configure', (event, payload: unknown) => {
    assertSender(event)
    return manager.configure(parseConfiguration(payload))
  })
  ipcMain.handle('device-provisioning:activate', (event, value: unknown) => {
    assertSender(event)
    return manager.activate(requiredString(value, '接入 UUID'))
  })
  ipcMain.handle('device-provisioning:retry', (event, value: unknown) => {
    assertSender(event)
    return manager.retry(requiredString(value, '接入 UUID'))
  })
  ipcMain.handle('device-provisioning:remove', (event, value: unknown) => {
    assertSender(event)
    return manager.remove(requiredString(value, '接入 UUID'))
  })
  ipcMain.handle('device-provisioning:restore', (event, value: unknown) => {
    assertSender(event)
    return manager.restore(requiredString(value, '接入 UUID'))
  })
  ipcMain.handle('device-provisioning:selectPath', async (event, value: unknown) => {
    assertSender(event)
    const selection = parsePathSelection(value)
    const selectedPath = await selectPackagePath(
      options.getMainWindow(),
      selection
    )
    if (selectedPath) {
      approvedPaths.approve(selection, selectedPath)
    }
    return selectedPath
  })
  ipcMain.handle('device-provisioning:inspect', (event, value: unknown) => {
    assertSender(event)
    const workspacePath = approvedPaths.require(
      { kind: 'packageWorkspace' },
      requiredString(value, 'Package Workspace')
    )
    return manager.inspectWorkspace(workspacePath)
  })
  ipcMain.handle('device-provisioning:upload', (event, payload: unknown) => {
    assertSender(event)
    const request = parseUploadRequest(payload)
    return manager.uploadWorkspace({
      cloudEnvironment: request.cloudEnvironment,
      workspacePath: approvedPaths.require(
        { kind: 'packageWorkspace' },
        request.workspacePath
      ),
      ak: request.ak,
      sk: request.sk
    })
  })
}

/**
 * 把 Renderer 输入收敛为一个固定云端环境中的设备模板请求。
 *
 * @param value 未受信任的跨进程输入。
 * @returns 仅包含环境身份和模板 UUID 的稳定请求。
 */
function parseCloudTemplateRequest(
  value: unknown
): StartLocalDeviceProvisioningInput {
  const raw = record(value, '云端设备模板请求')
  return {
    cloudEnvironment: requiredCloudEnvironment(raw.cloudEnvironment),
    templateUuid: requiredString(raw.templateUuid, '设备模板 UUID')
  }
}

/**
 * 把云端环境和设备广场筛选条件作为一个原子读取请求校验。
 *
 * @param value 未受信任的设备广场列表 IPC 载荷。
 * @returns 固定环境与允许分页筛选字段组成的请求。
 */
function parseSquareListRequest(value: unknown): {
  cloudEnvironment: CloudEnvironment
  query: DeviceSquareListQuery
} {
  const raw = record(value, '设备广场列表请求')
  return {
    cloudEnvironment: requiredCloudEnvironment(raw.cloudEnvironment),
    query: parseSquareQuery(raw.query)
  }
}

/** 把 Renderer 查询收敛为公开设备广场允许的分页和筛选字段。 */
function parseSquareQuery(value: unknown): DeviceSquareListQuery {
  if (value === undefined || value === null) return {}
  const raw = record(value, '设备广场查询')
  const query: DeviceSquareListQuery = {}
  if (raw.page !== undefined) query.page = positiveInteger(raw.page, 'page')
  if (raw.pageSize !== undefined) {
    query.pageSize = positiveInteger(raw.pageSize, 'pageSize')
  }
  if (raw.manufacturerUuid !== undefined) {
    query.manufacturerUuid = requiredString(
      raw.manufacturerUuid,
      'manufacturerUuid'
    )
  }
  if (raw.keyword !== undefined) query.keyword = String(raw.keyword).slice(0, 200)
  if (raw.tags !== undefined) {
    if (!Array.isArray(raw.tags)) throw new Error('tags 必须是字符串数组')
    query.tags = raw.tags.map((tag) => requiredString(tag, 'tag')).slice(0, 20)
  }
  return query
}

/**
 * 校验 Renderer 只提交接入身份、显式遗留接管意图和 JSON 配置值。
 *
 * @param value 未受信任的 Renderer 配置载荷。
 * @returns 可交给 Main 接入编排器的封闭配置请求。
 */
function parseConfiguration(value: unknown): ConfigureLocalDeviceProvisioningInput {
  const raw = record(value, '设备接入配置')
  const configuration = record(raw.configuration, 'configuration')
  return {
    provisioningId: requiredString(raw.provisioningId, '接入 UUID'),
    instanceId: requireRosDeviceInstanceId(
      requiredString(raw.instanceId, '设备实例 ID')
    ),
    displayName: requiredString(raw.displayName, '设备显示名称'),
    adoptExisting: requiredBoolean(raw.adoptExisting, '接管同名旧设备'),
    configuration: structuredClone(configuration)
  }
}

/**
 * 校验设备包上传只携带受控 Workspace、固定环境和一次性 AK/SK。
 *
 * @param value 未受信任的上传 IPC 载荷。
 * @returns 可交给 Main 编排器的一次性上传请求；错误不回显凭据值。
 */
function parseUploadRequest(value: unknown): DevicePackageUploadRequest {
  const raw = record(value, '设备包上传请求')
  return {
    workspacePath: requiredString(raw.workspacePath, 'Package Workspace'),
    cloudEnvironment: requiredCloudEnvironment(raw.cloudEnvironment),
    ak: requiredCredential(raw.ak, 'Lab AK'),
    sk: requiredCredential(raw.sk, 'Lab SK')
  }
}

/**
 * 校验受控路径选择器类别，拒绝 Renderer 请求任意文件规则。
 *
 * @param value 未受信任的路径选择 IPC 载荷。
 * @returns 只允许 Package Workspace 的选择意图。
 */
function parsePathSelection(value: unknown): DeviceProvisioningPathSelection {
  const raw = record(value, '设备包路径选择')
  if (raw.kind !== 'packageWorkspace') {
    throw new Error('设备包路径选择类别无效')
  }
  return { kind: raw.kind }
}

/**
 * 打开固定 Package Workspace 目录对话框并返回用户明确选择的路径。
 *
 * @param parent 当前 Electron 主窗口；为空时使用无父窗口系统对话框。
 * @param _selection 已校验且当前只有 Workspace 一种值的选择意图。
 * @returns 用户取消时为 null，否则为系统对话框返回的目录路径。
 */
async function selectPackagePath(
  parent: BrowserWindow | null,
  _selection: DeviceProvisioningPathSelection
): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    title: '选择 Package Workspace',
    properties: ['openDirectory']
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  return result.canceled ? null : result.filePaths[0] ?? null
}

/** 把 unknown 收窄为非数组 JSON object。 */
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}必须是 object`)
  }
  return value as Record<string, unknown>
}

/** 读取长度受限的必填字符串。 */
function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 4_096) {
    throw new Error(`${label}无效`)
  }
  return value.trim()
}

/**
 * 读取 Renderer 显式提交的布尔意图，禁止字符串等模糊真值。
 *
 * @param value 未受信任的布尔字段值。
 * @param label 只用于可行动错误的非秘密字段名称。
 * @returns 经过严格类型检查的布尔值。
 */
function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label}必须是 boolean`)
  return value
}

/**
 * 读取固定云端环境身份，拒绝 Renderer 提交任意 URL。
 *
 * @param value 未受信任的环境值。
 * @returns test、uat 或 production 环境身份。
 */
function requiredCloudEnvironment(value: unknown): CloudEnvironment {
  if (!isCloudEnvironment(value)) throw new Error('云端环境无效')
  return value
}

/**
 * 读取一次性上传凭据，不在错误正文中回显任何秘密内容。
 *
 * @param value 未受信任的 AK 或 SK 值。
 * @param label 仅用于错误字段名称的非秘密标签。
 * @returns 去除首尾空白且长度受限的凭据。
 */
function requiredCredential(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1_024) {
    throw new Error(`${label}无效`)
  }
  return value.trim()
}

/** 读取设备广场分页正整数并施加合理上限。 */
function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 10_000) {
    throw new Error(`${label}必须是正整数`)
  }
  return Number(value)
}
