import { dialog, type BrowserWindow } from 'electron'
import {
  DeviceCardAuthoringError,
  type DeviceCardAuthoringApprovalPort
} from '@unilab/device-card-host'

export class ElectronDeviceCardAuthoringApprovals
implements DeviceCardAuthoringApprovalPort {
  constructor(private readonly getMainWindow: () => BrowserWindow | null) {}

  async authorizeDirectory(
    input: Parameters<DeviceCardAuthoringApprovalPort['authorizeDirectory']>[0]
  ): Promise<boolean> {
    if (input.principal === 'renderer') return true
    const window = this.getMainWindow()
    if (!window || window.isDestroyed()) return false
    const operation = operationLabel(input.operation)
    const result = await dialog.showMessageBox(window, {
      type: 'question',
      buttons: ['拒绝', '允许'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
      title: '设备卡片 Agent 目录授权',
      message: `Agent 请求${operation}`,
      detail: [
        `设备：${input.target.title}（${input.target.deviceId}）`,
        `路径：${input.path}`,
        ...(input.replacesProjectDir
          ? [`将先关闭当前工作区：${input.replacesProjectDir}`]
          : []),
        '',
        '允许后，Electron 只会按卡片创作规则访问该路径。'
      ].join('\n')
    })
    return result.response === 1
  }

  async approveInstall(
    input: Parameters<DeviceCardAuthoringApprovalPort['approveInstall']>[0]
  ): Promise<boolean> {
    const window = this.getMainWindow()
    if (!window || window.isDestroyed()) return false
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5 * 60_000)
    let result
    try {
      result = await dialog.showMessageBox(window, {
        type: 'warning',
        buttons: ['取消', '重新构建并安装'],
        defaultId: 1,
        cancelId: 0,
        noLink: true,
        title: '确认安装设备卡片',
        message: `${input.cardId}@${input.cardVersion}`,
        detail: [
          `设备：${input.session.deviceId}`,
          `源码摘要：${input.sourceHash}`,
          `状态权限：${input.permissions.state.join('、') || '无'}`,
          `Action 权限：${input.permissions.actions.join('、') || '无'}`,
          '',
          'Electron 将从新的源码快照执行生产构建；Agent 不能绕过本确认。'
        ].join('\n'),
        signal: controller.signal
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DeviceCardAuthoringError(
          'APPROVAL_TIMEOUT',
          '用户未在 5 分钟内确认卡片安装。',
          { retryable: true, cause: error }
        )
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
    return result.response === 1
  }
}

function operationLabel(
  operation: Parameters<
    DeviceCardAuthoringApprovalPort['authorizeDirectory']
  >[0]['operation']
): string {
  if (operation === 'bootstrap') return '在以下空目录创建并接入卡片项目：'
  if (operation === 'attach') return '接入以下已有卡片项目：'
  if (operation === 'export-kit') return '导出 Authoring Kit 到：'
  return '导出检查通过的卡片源码到：'
}
