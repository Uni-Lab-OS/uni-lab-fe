import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  DeviceCardActionController,
  DeviceCardRobotCommissioningController,
  useServices,
  type DeviceCatalogItem
} from '@unilab/services'
import {
  DEVICE_CARD_HOST_STATE_SCHEMA,
  deviceCardDefinitionHasDrifted,
  deviceCardRealtimeStateKeys,
  deviceCardSupportsDevice
} from '@unilab/device-card-sdk'
import type {
  DeviceCardActionRun,
  DeviceCardActionContract,
  DeviceCardAgentEnvironmentInfo,
  DeviceCardAuthoringProfile,
  DeviceCardJointPreviewFrame,
  DeviceCardRuntimeSnapshot,
  DeviceCardWorkspaceStatus,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'
import {
  clearJointStateFrame,
  getJointStateFrame,
  publishDeviceJointStateFrame,
  publishJointStateFrame
} from '@unilab/scene-runtime'

import { buildAuthoringSampleState } from '../../data/authoringContext'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import {
  deviceCardActionContractSignature,
  isDeviceCardLiveBinding,
  type DeviceCardLiveBinding
} from './runtimeBinding'
import { buildDeviceCardRuntimeState } from './runtimeState'
import type { WorkbenchNotice } from './deviceCardWorkbenchSupport'
import { useDeviceCardWorkspaceActions } from './useDeviceCardWorkspaceActions'

export function useDeviceCardWorkbench() {
  const services = useServices()
  const desktopApi = window.api?.deviceCards
  const fileApi = window.api?.file
  const desktopAvailable = Boolean(desktopApi)
  const fileAvailable = Boolean(fileApi)
  const { statusMap, subscribeJointState } = useDeviceStatus()
  const previewRef = useRef<HTMLDivElement | null>(null)
  const runtimeStateRef = useRef<Record<string, unknown>>({})
  const devicesRef = useRef<DeviceCatalogItem[]>([])
  const [cards, setCards] = useState<InstalledDeviceCard[]>([])
  const [devices, setDevices] = useState<DeviceCatalogItem[]>([])
  const [selectedCardKey, setSelectedCardKey] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [liveBinding, setLiveBinding] =
    useState<DeviceCardLiveBinding | null>(null)
  const [authoringProfile, setAuthoringProfile] =
    useState<DeviceCardAuthoringProfile>('vue-web-component-v1')
  const [workspace, setWorkspace] =
    useState<DeviceCardWorkspaceStatus | null>(null)
  const [agentInfo, setAgentInfo] =
    useState<DeviceCardAgentEnvironmentInfo | null>(null)
  const [message, setMessage] = useState<WorkbenchNotice | null>(null)

  const refreshDeviceCatalog = useCallback(async () => {
    try {
      setDevices(await services.laboratory.getDeviceCatalog())
    } catch (error) {
      setMessage({
        kind: 'warning',
        text: error instanceof Error
          ? `同步设备目录失败：${error.message}`
          : '同步设备目录失败'
      })
    }
  }, [services.laboratory])

  const refresh = useCallback(async () => {
    if (!desktopApi) return
    setMessage(null)
    try {
      const [installed, workspaceStatus, currentAgentInfo] = await Promise.all([
        desktopApi.list(),
        desktopApi.workspace.get(),
        desktopApi.agent.getInfo()
      ])
      setCards(installed)
      setWorkspace(workspaceStatus)
      setAgentInfo(currentAgentInfo)
      setSelectedCardKey((current) =>
        installed.some((card) => card.key === current)
          ? current
          : installed[0]?.key ?? ''
      )
      await refreshDeviceCatalog()
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '加载设备卡片失败'
      })
    }
  }, [desktopApi, refreshDeviceCatalog])

  useEffect(() => {
    void refresh()
    return () => {
      void desktopApi?.close()
    }
  }, [desktopApi, refresh])

  useEffect(() => {
    const subscription = services.workflow.subscribeWorkflowRuntime((event) => {
      if (event.event === 'device.catalog.changed') {
        void refreshDeviceCatalog()
      }
    })
    return () => subscription.dispose()
  }, [refreshDeviceCatalog, services.workflow])

  useEffect(() => {
    if (!desktopApi) return
    return desktopApi.workspace.onStatus((status) => {
      setWorkspace(status)
    })
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    let receivedSinceLog = 0
    let lastLoggedAt = 0
    console.info('[joint-preview] stage=workbench status=listener_ready surface=kernel')
    return desktopApi.onJointPreview((frame) => {
      try {
        const accepted = publishJointStateFrame({ ...frame, source: 'mock' })
        receivedSinceLog += 1
        const now = Date.now()
        if (lastLoggedAt === 0 || now - lastLoggedAt >= 1_000) {
          console.info(
            `[joint-preview] stage=workbench status=${accepted.updatedAt > frame.updatedAt ? 'stale' : 'published'} surface=kernel material=${jointPreviewDiagnosticToken(frame.materialId)} joints=${Object.keys(frame.jointStates).length} events=${receivedSinceLog}`
          )
          receivedSinceLog = 0
          lastLoggedAt = now
        }
      } catch (error) {
        console.error(
          `[joint-preview] stage=workbench status=rejected surface=kernel material=${jointPreviewDiagnosticToken(frame.materialId)} reason=invalid_frame`,
          error
        )
      }
    })
  }, [desktopApi])

  const selectedCard = cards.find((card) => card.key === selectedCardKey)
  const selectedDevice = devices.find(
    (device) => device.deviceId === selectedDeviceId
  ) ?? devices[0]
  const workspaceCard = workspace?.card
  const workspaceActive = workspace !== null
  const previewCard = workspaceCard ?? selectedCard
  const previewDevice = selectedDevice && previewCard && deviceCardSupportsDevice(
    previewCard,
    selectedDevice.definitionFqid,
    selectedDevice.deviceTypeId
  )
    ? selectedDevice
    : undefined
  const previewDeviceId = previewDevice?.deviceId ?? ''
  const previewDeviceTypeId = previewDevice?.deviceTypeId ?? ''
  const previewDeviceLabel = previewDevice?.label ?? ''
  const previewActionSignature = deviceCardActionContractSignature(
    previewDevice?.actions ?? []
  )
  const previewActionContracts = useMemo<DeviceCardActionContract[]>(
    () => JSON.parse(previewActionSignature) as DeviceCardActionContract[],
    [previewActionSignature]
  )
  const previewStateSignature = previewDevice
    ? deviceCardRealtimeStateKeys({
        ...(previewDevice.stateSchema ?? {}),
        ...DEVICE_CARD_HOST_STATE_SCHEMA
      }).join('\u0000')
    : ''
  const previewFallbackDeviceTypeId = previewCard?.legacyDeviceTypes[0]
    ?? previewCard?.definitionFqids[0]
    ?? ''
  const previewDefinitionFqid = previewDevice?.definitionFqid
    ?? previewCard?.definitionFqids[0]
    ?? ''
  const previewCardTitle = previewCard?.title ?? ''
  const previewId = workspaceCard
    ? `workspace:${workspaceCard.sourceHash}`
    : selectedCard
      ? `installed:${selectedCard.key}`
      : ''
  const liveMode = isDeviceCardLiveBinding(
    liveBinding,
    previewId,
    previewDeviceId
  )
  const previousJointBindingRef = useRef({
    liveMode,
    materialId: previewDevice?.materialUuid
  })
  const agentReady = Boolean(
    agentInfo?.bridge.enabled &&
    agentInfo.cli.installed &&
    agentInfo.cli.compatible
  )

  useEffect(() => {
    let receivedSinceLog = 0
    let lastLoggedAt = 0
    return subscribeJointState((frame) => {
      try {
        const accepted = publishDeviceJointStateFrame(
          frame,
          devicesRef.current.map(device => ({
            deviceId: device.deviceId,
            materialId: device.materialUuid
          })),
          liveMode ? 'live' : 'mock'
        )
        if (!accepted) return
        receivedSinceLog += 1
        const now = Date.now()
        if (lastLoggedAt === 0 || now - lastLoggedAt >= 1_000) {
          console.info(
            `[joint-stream] stage=workbench status=published surface=kernel device=${jointPreviewDiagnosticToken(frame.deviceId)} material=${jointPreviewDiagnosticToken(accepted.materialId)} joints=${Object.keys(frame.jointStates).length} events=${receivedSinceLog}`
          )
          receivedSinceLog = 0
          lastLoggedAt = now
        }
      } catch (error) {
        console.error(
          `[joint-stream] stage=workbench status=rejected surface=kernel device=${jointPreviewDiagnosticToken(frame.deviceId)} reason=invalid_frame`,
          error
        )
      }
    })
  }, [liveMode, subscribeJointState])

  useEffect(() => {
    const previous = previousJointBindingRef.current
    const materialId = previewDevice?.materialUuid
    if (liveMode || previous.liveMode !== liveMode) {
      if (previous.materialId) clearJointStateFrame(previous.materialId)
      if (materialId && materialId !== previous.materialId) {
        clearJointStateFrame(materialId)
      }
    }
    previousJointBindingRef.current = { liveMode, materialId }
  }, [liveMode, previewDevice?.materialUuid])

  useEffect(() => {
    setSelectedDeviceId((current) =>
      devices.some((device) => device.deviceId === current)
        ? current
        : devices[0]?.deviceId ?? ''
    )
  }, [devices])

  useEffect(() => {
    if (!previewCard) return
    setSelectedDeviceId(current => {
      const currentDevice = devices.find(device => device.deviceId === current)
      if (currentDevice && deviceCardSupportsDevice(
        previewCard,
        currentDevice.definitionFqid,
        currentDevice.deviceTypeId
      )) return current
      return devices.find(device => deviceCardSupportsDevice(
        previewCard,
        device.definitionFqid,
        device.deviceTypeId
      ))?.deviceId ?? current
    })
  }, [devices, previewCard])

  devicesRef.current = devices

  useEffect(() => {
    if (
      !liveBinding ||
      isDeviceCardLiveBinding(liveBinding, previewId, previewDeviceId)
    ) return
    // 绑定失效时先关闭主进程 Live 会话，不给旧卡片留下调用窗口。
    void desktopApi?.close()
    setLiveBinding(null)
  }, [desktopApi, liveBinding, previewDeviceId, previewId])

  const runtimeState = useMemo<Record<string, unknown>>(() => {
    if (!selectedDevice) return { status: 'idle', online: false }
    // Edge /api/v1/ws/device_status 真值；online / actionBusy 仍来自目录。
    return buildDeviceCardRuntimeState(selectedDevice, statusMap)
  }, [selectedDevice, statusMap])
  const previewState = useMemo<Record<string, unknown>>(
    () => (previewDevice ? runtimeState : { status: 'idle', online: false }),
    [previewDevice, runtimeState]
  )
  const previewMockState = useMemo<Record<string, unknown>>(
    () => previewDevice
      ? buildAuthoringSampleState(previewDevice, { online: false })
      : { status: 'idle', online: false },
    [previewDevice]
  )
  const activePreviewState = liveMode ? previewState : previewMockState
  runtimeStateRef.current = activePreviewState

  useEffect(() => {
    if (!desktopApi || !previewCard || !previewRef.current) return
    const preview = previewRef.current
    let disposed = false
    const storedJointFrame = !liveMode && previewDevice?.materialUuid
      ? getJointStateFrame(previewDevice.materialUuid)
      : null
    const jointPreview: DeviceCardJointPreviewFrame | undefined =
      storedJointFrame
        ? {
            materialId: storedJointFrame.materialId,
            jointStates: storedJointFrame.jointStates,
            updatedAt: storedJointFrame.updatedAt,
            ...(storedJointFrame.modelRevision
              ? { modelRevision: storedJointFrame.modelRevision }
              : {})
          }
        : undefined
    const context: DeviceCardRuntimeSnapshot = {
      mode: liveMode ? 'live' : 'mock',
      device: {
        // Mock 也绑定当前 OS 设备实例；OS 会强制它只能打开 simulation Runtime。
        deviceId: previewDeviceId || null,
        materialId: previewDevice?.materialUuid ?? null,
        definitionFqid: previewDefinitionFqid,
        ...(previewDevice?.definition
          ? { definition: previewDevice.definition }
          : {}),
        deviceTypeId:
          previewDefinitionFqid || previewDeviceTypeId || previewFallbackDeviceTypeId,
        title: previewDeviceLabel || previewCardTitle
      },
      state: runtimeStateRef.current,
      config: {},
      ...(jointPreview ? { jointPreview } : {}),
      theme: 'light',
      locale: 'zh-CN'
    }
    const syncBounds = (): void => {
      const rect = preview.getBoundingClientRect()
      void desktopApi.updateBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      })
    }
    const observer = new ResizeObserver(syncBounds)
    observer.observe(preview)
    const frame = requestAnimationFrame(() => {
      const rect = preview.getBoundingClientRect()
      const request = {
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        context,
        availableActions: previewDevice
          ? previewActionContracts
          : undefined,
        availableState: liveMode
          ? previewStateSignature
            ? previewStateSignature.split('\u0000')
            : []
          : undefined,
        availableMedia: liveMode ? [] : undefined
      }
      const opening = workspaceActive
        ? desktopApi.workspace.preview(request)
        : desktopApi.open({ ...request, key: selectedCard?.key ?? '' })
      void opening.catch((error) => {
        if (!disposed) {
          setMessage({
            kind: 'error',
            text: error instanceof Error ? error.message : '打开卡片失败'
          })
        }
      })
    })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      void desktopApi.close()
    }
  }, [
    desktopApi,
    previewActionSignature,
    previewActionContracts,
    previewCardTitle,
    previewDeviceId,
    previewDeviceLabel,
    previewDevice?.materialUuid,
    previewDeviceTypeId,
    previewFallbackDeviceTypeId,
    previewDefinitionFqid,
    previewStateSignature,
    liveMode,
    selectedCard?.key,
    workspaceActive,
    workspaceCard?.sourceHash
  ])

  useEffect(() => {
    if (!desktopApi || !previewCard) return
    void desktopApi.updateState(activePreviewState)
  }, [activePreviewState, desktopApi, previewCard])

  useEffect(() => {
    if (!desktopApi) return
    const abortController = new AbortController()
    const controller = new DeviceCardActionController({
      workflow: services.workflow,
      tasks: services.deviceActionTasks,
      actionTasksSupported: services.capabilities.devices.runActionTask
    })
    const unsubscribe = desktopApi.onActionRequest((request) => {
      const device = devicesRef.current.find(
        (candidate) => candidate.deviceId === request.deviceId
      )
      const running = device
        ? controller.execute(request, device, {
            signal: abortController.signal
          })
        : Promise.resolve<DeviceCardActionRun>({
            requestId: request.requestId,
            action: request.action,
            status: 'ERROR',
            error: `未找到设备：${request.deviceId}`
          })
      void running.then(desktopApi.resolveAction)
    })
    return () => {
      abortController.abort()
      unsubscribe()
    }
  }, [
    desktopApi,
    services.capabilities.devices.runActionTask,
    services.deviceActionTasks,
    services.workflow
  ])

  useEffect(() => {
    if (!desktopApi) return
    const controller = new DeviceCardRobotCommissioningController(
      services.robotCommissioning
    )
    const unsubscribe = desktopApi.onRobotCommissioningRequest((request) => {
      void controller.execute(request)
        .then(desktopApi.resolveRobotCommissioning)
        .catch((error) => {
          setMessage({
            kind: 'error',
            text: error instanceof Error
              ? `回传机械臂调试结果失败：${error.message}`
              : '回传机械臂调试结果失败。'
          })
        })
    })
    return () => {
      unsubscribe()
      void controller.dispose()
    }
  }, [desktopApi, services.robotCommissioning])

  const workspaceActions = useDeviceCardWorkspaceActions({
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
    setSelectedCardKey,
    setMessage
  })


  const toggleLiveBinding = (): void => {
    if (!previewCard || !previewDevice || !previewId) return
    if (liveMode) {
      void desktopApi?.close()
      setLiveBinding(null)
      setMessage({
        kind: 'info',
        text: '已退出 Live，卡片恢复为 Mock 预览，不能调用真实设备。'
      })
      return
    }
    if (!previewDevice.online) {
      setMessage({
        kind: 'warning',
        text: `设备 ${previewDevice.deviceId} 当前离线，不能应用卡片。`
      })
      return
    }
    if (
      previewCard.definitionTargets.length === 0 ||
      !previewDevice.definition
    ) {
      setMessage({
        kind: 'warning',
        text: '该卡片或设备没有完整的领域设备包定义；v1 遗留卡片只能使用 Mock。'
      })
      return
    }
    const definitionTarget = previewCard.definitionTargets.find(
      target => target.definitionFqid === previewDevice.definition?.fqid
    )
    const drifted = definitionTarget
      ? deviceCardDefinitionHasDrifted(definitionTarget, previewDevice.definition)
      : false
    setLiveBinding({
      previewId,
      deviceId: previewDevice.deviceId
    })
    setMessage({
      kind: 'warning',
      text: drifted
        ? `设备定义已更新，已按当前能力重新校验并应用到 ${previewDevice.deviceId}。`
        : `已明确应用到 ${previewDevice.deviceId}。Live 卡片可以调用该设备声明的 Action。`
    })
  }

  const previewDescription = (() => {
    if (workspace) {
      if (workspace.state !== 'ready') {
        return workspace.card
          ? '正在检查修改，暂时显示上次成功版本'
          : '正在检查源码，通过后自动显示预览'
      }
      return liveMode && previewDevice
        ? `开发预览 / Live 设备 ${previewDevice.deviceId}`
        : '开发预览 / Mock 模式'
    }
    if (liveMode && previewDevice) {
      return `已安装卡片 / Live 设备 ${previewDevice.deviceId}`
    }
    if (previewDevice) {
      return `已安装卡片 / Mock 模式 / 可应用到 ${previewDevice.deviceId}`
    }
    return previewCard && selectedDevice
      ? `Mock 模式 / 不支持设备定义 ${
          selectedDevice.definitionFqid ?? selectedDevice.deviceTypeId
        }`
      : 'Mock 模式 / 未绑定设备'
  })()

  return {
    agentInfo,
    agentReady,
    authoringProfile,
    cards,
    closeWorkspace: workspaceActions.closeWorkspace,
    copyAgentPrompt: workspaceActions.copyAgentPrompt,
    desktopAvailable,
    devices,
    exportAuthoringKit: workspaceActions.exportAuthoringKit,
    exportingKit: workspaceActions.exportingKit,
    fileAvailable,
    installWorkspace: workspaceActions.installWorkspace,
    liveMode,
    message,
    openWorkspace: workspaceActions.openWorkspace,
    prepareAgentProject: workspaceActions.prepareAgentProject,
    previewCard,
    previewDescription,
    previewDevice,
    previewRef,
    rebuildWorkspace: workspaceActions.rebuildWorkspace,
    revealWorkspace: workspaceActions.revealWorkspace,
    selectedCardKey,
    selectedDevice,
    setAuthoringProfile,
    setSelectedCardKey,
    setSelectedDeviceId,
    toggleAgentBridge: workspaceActions.toggleAgentBridge,
    toggleAgentCli: workspaceActions.toggleAgentCli,
    toggleLiveBinding,
    workspace,
    workspaceOperation: workspaceActions.workspaceOperation,
  }
}

function jointPreviewDiagnosticToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:@-]+/gu, '_').slice(0, 160)
}
