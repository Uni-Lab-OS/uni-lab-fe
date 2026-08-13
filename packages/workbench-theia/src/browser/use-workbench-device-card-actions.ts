import { createDeviceCardAuthoringKit } from '@unilab/device-card-authoring-kit'
import type {
  DeviceCardAuthoringProfile,
  DeviceCardWorkspaceStatus,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'
import type { DeviceCatalogItem } from '@unilab/services'
import { useState, type Dispatch, type SetStateAction } from 'react'

import type {
  WorkbenchDesktopDeviceCardApi,
  WorkbenchDesktopFileApi
} from './workbench-desktop-device-card-api'
import {
  buildWorkbenchDeviceCardAuthoringContext,
  workbenchDeviceCardErrorNotice,
  type WorkbenchDeviceCardNotice,
  type WorkbenchDeviceCardOperation
} from './workbench-device-card-support'

interface WorkbenchDeviceCardActionOptions {
  desktopApi: WorkbenchDesktopDeviceCardApi | undefined
  fileApi: WorkbenchDesktopFileApi | undefined
  selectedDevice: DeviceCatalogItem | undefined
  runtimeState: Record<string, unknown>
  authoringProfile: DeviceCardAuthoringProfile
  workspace: DeviceCardWorkspaceStatus | null
  refresh: () => Promise<InstalledDeviceCard[]>
  setWorkspace: Dispatch<SetStateAction<DeviceCardWorkspaceStatus | null>>
  setSelectedCardKey: Dispatch<SetStateAction<string>>
  setMessage: Dispatch<SetStateAction<WorkbenchDeviceCardNotice | null>>
}

/**
 * 集中管理设备卡导入、源码工作区和离线开发包命令。
 *
 * @param options 当前设备、桌面端口和权威状态写入器。
 * @returns 可由 Workbench 侧栏调用的命令及互斥进行中状态。
 */
export function useWorkbenchDeviceCardActions(
  options: WorkbenchDeviceCardActionOptions
) {
  const {
    desktopApi,
    fileApi,
    selectedDevice,
    runtimeState,
    authoringProfile,
    workspace,
    refresh,
    setWorkspace,
    setSelectedCardKey,
    setMessage
  } = options
  const [operation, setOperation] =
    useState<WorkbenchDeviceCardOperation>(null)

  /** 从本机选择并导入一个已经构建的设备卡包。 */
  const importCard = async (): Promise<void> => {
    if (!desktopApi || operation !== null) return
    setOperation('import')
    setMessage(null)
    try {
      const installed = await desktopApi.importCard()
      if (!installed) return
      await refresh()
      setSelectedCardKey(installed.key)
      setMessage({
        kind: 'success',
        text: `已导入设备卡：${installed.title} ${installed.version}`
      })
    } catch (error) {
      setMessage(workbenchDeviceCardErrorNotice(error, '导入设备卡失败'))
    } finally {
      setOperation(null)
    }
  }

  /** 为当前设备创建一个受约束的设备卡源码项目。 */
  const prepareWorkspace = async (): Promise<void> => {
    if (!desktopApi || !selectedDevice || operation !== null) return
    setOperation('prepare')
    setMessage(null)
    try {
      const result = await desktopApi.authoring.prepare({
        deviceId: selectedDevice.deviceId,
        profile: authoringProfile
      })
      if (!result) return
      setWorkspace(result.workspace)
      setMessage({
        kind: result.workspace.state === 'ready' ? 'success' : 'warning',
        text: result.workspace.state === 'ready'
          ? '项目已创建并检查通过，保存源码后预览会自动刷新。'
          : '项目已创建，请根据结构化诊断修复当前错误。'
      })
    } catch (error) {
      setMessage(workbenchDeviceCardErrorNotice(error, '创建设备卡项目失败'))
    } finally {
      setOperation(null)
    }
  }

  /** 授权并打开已有设备卡源码目录。 */
  const openWorkspace = async (): Promise<void> => {
    if (!desktopApi || !selectedDevice || operation !== null) return
    setOperation('open')
    setMessage(null)
    try {
      const status = await desktopApi.workspace.open(
        buildWorkbenchDeviceCardAuthoringContext(selectedDevice, runtimeState)
      )
      if (!status) return
      setWorkspace(status)
      setMessage({
        kind: status.state === 'ready' ? 'success' : 'warning',
        text: status.state === 'ready'
          ? '源码目录已打开，保存后会自动检查并刷新预览。'
          : '源码目录已打开，请根据结构化诊断修复当前错误。'
      })
    } catch (error) {
      setMessage(workbenchDeviceCardErrorNotice(error, '打开设备卡项目失败'))
    } finally {
      setOperation(null)
    }
  }

  /** 重新检查当前源码工作区并刷新开发预览。 */
  const rebuildWorkspace = async (): Promise<void> => {
    if (!desktopApi || !workspace || operation !== null) return
    setOperation('rebuild')
    setMessage(null)
    try {
      const status = await desktopApi.workspace.rebuild()
      setWorkspace(status)
      setMessage(status.state === 'ready'
        ? { kind: 'success', text: '当前源码检查通过，开发预览已刷新。' }
        : { kind: 'warning', text: '当前源码仍有错误，请查看诊断后重试。' })
    } catch (error) {
      setMessage(workbenchDeviceCardErrorNotice(error, '重新检查设备卡项目失败'))
    } finally {
      setOperation(null)
    }
  }

  /** 从检查通过的源码快照构建并安装设备卡。 */
  const installWorkspace = async (): Promise<void> => {
    if (!desktopApi || workspace?.state !== 'ready' || operation !== null) return
    setOperation('install')
    setMessage(null)
    try {
      const installed = await desktopApi.workspace.install()
      await refresh()
      setSelectedCardKey(installed.key)
      setMessage({
        kind: 'success',
        text: `已从当前源码快照安装：${installed.title} ${installed.version}`
      })
    } catch (error) {
      setMessage(workbenchDeviceCardErrorNotice(error, '安装当前设备卡源码失败'))
    } finally {
      setOperation(null)
    }
  }

  /** 关闭当前源码工作区并返回已安装卡片库。 */
  const closeWorkspace = async (): Promise<void> => {
    if (!desktopApi || !workspace || operation !== null) return
    setOperation('close')
    setMessage(null)
    try {
      await desktopApi.workspace.close()
      setWorkspace(null)
      setMessage({ kind: 'info', text: '设备卡源码工作区已关闭。' })
    } catch (error) {
      setMessage(workbenchDeviceCardErrorNotice(error, '关闭设备卡项目失败'))
    } finally {
      setOperation(null)
    }
  }

  /** 导出当前设备的离线设备卡开发包。 */
  const exportAuthoringKit = async (): Promise<void> => {
    if (!fileApi || !selectedDevice || operation !== null) return
    setOperation('export')
    setMessage(null)
    try {
      const kit = await createDeviceCardAuthoringKit({
        context: buildWorkbenchDeviceCardAuthoringContext(
          selectedDevice,
          runtimeState
        ),
        profile: authoringProfile
      })
      const saved = await fileApi.saveBinary({
        defaultName: kit.fileName,
        content: kit.archive
      })
      if (saved) {
        setMessage({
          kind: 'success',
          text: `设备卡离线开发包已保存：${saved.path}`
        })
      }
    } catch (error) {
      setMessage(workbenchDeviceCardErrorNotice(error, '导出设备卡离线开发包失败'))
    } finally {
      setOperation(null)
    }
  }

  /** 在系统文件管理器中定位当前设备卡源码目录。 */
  const revealWorkspace = (): void => {
    if (!desktopApi || !workspace) return
    void desktopApi.authoring.reveal(workspace.projectDir).catch(error => {
      setMessage(workbenchDeviceCardErrorNotice(error, '打开设备卡源码目录失败'))
    })
  }

  return {
    closeWorkspace,
    exportAuthoringKit,
    importCard,
    installWorkspace,
    openWorkspace,
    operation,
    prepareWorkspace,
    rebuildWorkspace,
    revealWorkspace
  }
}
