import { createDeviceCardAuthoringKit } from '@unilab/device-card-authoring-kit'
import type {
  DeviceCardAgentEnvironmentInfo,
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
  agentInfo: DeviceCardAgentEnvironmentInfo | null
  agentReady: boolean
  refresh: () => Promise<InstalledDeviceCard[]>
  setWorkspace: Dispatch<SetStateAction<DeviceCardWorkspaceStatus | null>>
  setAgentInfo: Dispatch<SetStateAction<DeviceCardAgentEnvironmentInfo | null>>
  setAgentError: Dispatch<SetStateAction<string | null>>
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
    agentInfo,
    agentReady,
    refresh,
    setWorkspace,
    setAgentInfo,
    setAgentError,
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

  /**
   * 安装、更新或移除随 Workbench 分发的设备卡 Agent CLI。
   *
   * @returns 操作完成后更新 Agent 环境快照；失败时写入独立错误和通知。
   */
  const toggleAgentCli = async (): Promise<void> => {
    if (!desktopApi || !agentInfo || operation !== null) return
    setOperation('agent')
    setMessage(null)
    setAgentError(null)
    try {
      const next = agentInfo.cli.installed && agentInfo.cli.compatible
        ? await desktopApi.agent.removeCli()
        : await desktopApi.agent.installCli()
      setAgentInfo(next)
      setMessage({
        kind: 'success',
        text: next.cli.installed
          ? `Agent CLI 已安装：${next.cli.installPath}`
          : 'Agent CLI 已移除。'
      })
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : '更新 Agent CLI 失败')
      setMessage(workbenchDeviceCardErrorNotice(error, '更新 Agent CLI 失败'))
    } finally {
      setOperation(null)
    }
  }

  /**
   * 启用或停用本机设备卡 Agent Bridge。
   *
   * @returns 操作完成后更新 Agent 环境快照；失败时保持当前能力事实。
   */
  const toggleAgentBridge = async (): Promise<void> => {
    if (!desktopApi || !agentInfo || operation !== null) return
    setOperation('agent')
    setMessage(null)
    setAgentError(null)
    try {
      const next = await desktopApi.agent.setBridgeEnabled(
        !agentInfo.bridge.enabled
      )
      setAgentInfo(next)
      setMessage({
        kind: 'success',
        text: next.bridge.enabled
          ? 'AI 编程助手连接已启用。'
          : 'AI 编程助手连接已停止。'
      })
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : '更新 AI 助手连接失败')
      setMessage(workbenchDeviceCardErrorNotice(error, '更新 AI 助手连接失败'))
    } finally {
      setOperation(null)
    }
  }

  /**
   * 将当前源码工作区的受约束开发指令复制到系统剪贴板。
   *
   * @returns 复制完成后发布成功通知；剪贴板不可用时发布精确错误。
   */
  const copyAgentPrompt = async (): Promise<void> => {
    if (
      !workspace
      || !agentInfo
      || !agentReady
      || operation !== null
    ) return
    setOperation('copy')
    setMessage(null)
    try {
      const clipboard = globalThis.navigator?.clipboard
      if (!clipboard) throw new Error('系统剪贴板不可用')
      await clipboard.writeText(
        buildWorkbenchDeviceCardAgentPrompt(workspace, agentInfo)
      )
      setMessage({ kind: 'success', text: 'AI 开发指令已复制。' })
    } catch (error) {
      setMessage(workbenchDeviceCardErrorNotice(
        error,
        '复制 AI 开发指令失败，请确认 Workbench 有剪贴板权限'
      ))
    } finally {
      setOperation(null)
    }
  }

  return {
    closeWorkspace,
    copyAgentPrompt,
    exportAuthoringKit,
    importCard,
    installWorkspace,
    openWorkspace,
    operation,
    prepareWorkspace,
    rebuildWorkspace,
    revealWorkspace,
    toggleAgentBridge,
    toggleAgentCli
  }
}

/**
 * 生成交给 AI 编程助手的设备卡开发指令。
 *
 * @param workspace 当前受 Electron 管理的设备卡源码工作区。
 * @param agentInfo 本机 Agent CLI 命令与桥接能力快照。
 * @returns 包含项目边界、安全约束和检查命令的可复制文本。
 */
export function buildWorkbenchDeviceCardAgentPrompt(
  workspace: DeviceCardWorkspaceStatus,
  agentInfo: DeviceCardAgentEnvironmentInfo
): string {
  const command = [
    quoteWorkbenchCommand(agentInfo.cli.command),
    'workspace status',
    '--project',
    quoteWorkbenchCommand(workspace.projectDir),
    '--json'
  ].join(' ')
  return [
    `请开发 ${workspace.projectDir} 中的 Uni-Lab 设备卡片。`,
    '先完整阅读 AGENTS.md、CARD_SPEC.md、authoring-context.json、card.manifest.json 和 mock.json；仅按声明的设备能力修改 src，设计专业的实验室界面。禁止安装依赖、使用网络、Node.js 或未声明的状态和 Action。',
    '只有 authoring-context.json 中经 SDK 判定为正式可订阅的 Driver/Host 状态键才能进入状态权限和实时面板；Action 输出以及 action-inferred、runtime-sample、unresolved 字段不是实时状态。',
    '运行时只允许通过 Host Bridge 读取当前 deviceId 的状态并调用 Action，禁止直连设备或 WebSocket。Action 输入只是草稿，实时值必须等待设备上报；切换实例不得沿用旧值。处理离线、忙碌、失败、未上报及 Mock/Live 模式。',
    `每次修改后运行：\n${command}\n失败时读取 .unilab-card/diagnostics.json 并修复到 ready。不要安装卡片或调用真实设备 Action。`
  ].join('\n\n')
}

/**
 * 为 Agent CLI 参数增加最小双引号转义。
 *
 * @param value CLI 路径或源码项目路径。
 * @returns 可嵌入复制命令的双引号参数。
 */
function quoteWorkbenchCommand(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}
