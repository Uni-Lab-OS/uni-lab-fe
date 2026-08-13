import {
  DEVICE_CARD_HOST_STATE_SCHEMA,
  deviceCardDefinitionHasDrifted,
  deviceCardRealtimeStateKeys,
  deviceCardSupportsDevice,
  type DeviceCardActionContract,
  type DeviceCardActionRun,
  type DeviceCardAgentEnvironmentInfo,
  type DeviceCardAuthoringProfile,
  type DeviceCardJointPreviewFrame,
  type DeviceCardRuntimeSnapshot,
  type DeviceCardWorkspaceStatus,
  type InstalledDeviceCard
} from '@unilab/device-card-sdk'
import {
  DeviceCardActionController,
  type DeviceCatalogItem,
  type DeviceStatus,
  type Services
} from '@unilab/services'
import {
  clearJointStateFrame,
  getJointStateFrame,
  publishJointStateFrame
} from '@unilab/scene-runtime'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { useWorkbenchDeviceCardActions } from './use-workbench-device-card-actions'
import {
  getWorkbenchDesktopCardBridge
} from './workbench-desktop-device-card-api'
import {
  buildWorkbenchDeviceCardAuthoringTarget,
  buildWorkbenchDeviceCardRuntimeState,
  buildWorkbenchDeviceCardSampleState,
  isWorkbenchDeviceCardLiveBinding,
  workbenchDeviceCardActionSignature,
  workbenchDeviceCardErrorNotice,
  type WorkbenchDeviceCardLiveBinding,
  type WorkbenchDeviceCardNotice
} from './workbench-device-card-support'

interface UseWorkbenchDeviceCardsOptions {
  services: Services
  active: boolean
}

/**
 * 连接 Workbench 的 OS 设备域与 Electron 设备卡受控运行时。
 *
 * @param options 当前服务组合根和仪器设备域可见状态。
 * @returns 设备卡侧栏、Mock/Live 绑定和原生预览所需的单一视图模型。
 */
export function useWorkbenchDeviceCards({
  services,
  active
}: UseWorkbenchDeviceCardsOptions) {
  const bridge = useMemo(getWorkbenchDesktopCardBridge, [])
  const desktopApi = bridge.deviceCards
  const previewRef = useRef<HTMLDivElement | null>(null)
  const statusMapRef = useRef(new Map<string, DeviceStatus>())
  const runtimeStateRef = useRef<Record<string, unknown>>({})
  const devicesRef = useRef<DeviceCatalogItem[]>([])
  const [cards, setCards] = useState<InstalledDeviceCard[]>([])
  const [devices, setDevices] = useState<DeviceCatalogItem[]>([])
  const [statusMap, setStatusMap] =
    useState<ReadonlyMap<string, DeviceStatus>>(statusMapRef.current)
  const [selectedCardKey, setSelectedCardKey] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [liveBinding, setLiveBinding] =
    useState<WorkbenchDeviceCardLiveBinding | null>(null)
  const [authoringProfile, setAuthoringProfile] =
    useState<DeviceCardAuthoringProfile>('vue-web-component-v1')
  const [workspace, setWorkspace] =
    useState<DeviceCardWorkspaceStatus | null>(null)
  const [agentInfo, setAgentInfo] =
    useState<DeviceCardAgentEnvironmentInfo | null>(null)
  const [agentLoading, setAgentLoading] = useState(Boolean(desktopApi))
  const [agentError, setAgentError] = useState<string | null>(null)
  const [message, setMessage] =
    useState<WorkbenchDeviceCardNotice | null>(null)
  const [loading, setLoading] = useState(Boolean(desktopApi))
  const agentReady = Boolean(
    agentInfo?.cli.installed
    && agentInfo.cli.compatible
    && agentInfo.bridge.enabled
  )
  /** 读取 OS 的正式设备目录并保留当前有效选择。 */
  const refreshDeviceCatalog = useCallback(async (): Promise<DeviceCatalogItem[]> => {
    try {
      const next = await services.laboratory.getDeviceCatalog()
      setDevices(next)
      return next
    } catch (error) {
      setMessage({
        kind: 'warning',
        text: error instanceof Error
          ? `同步设备目录失败：${error.message}`
          : '同步设备目录失败，请确认 Uni-Lab OS 已就绪。'
      })
      return []
    }
  }, [services.laboratory])

  /** 同步已安装卡片、源码工作区和 OS 设备目录。 */
  const refresh = useCallback(async (): Promise<InstalledDeviceCard[]> => {
    if (!desktopApi) return []
    setLoading(true)
    try {
      const [installed, workspaceStatus] = await Promise.all([
        desktopApi.list(),
        desktopApi.workspace.get()
      ])
      setCards(installed)
      setWorkspace(workspaceStatus)
      setSelectedCardKey(current => installed.some(card => card.key === current)
        ? current
        : installed[0]?.key ?? '')
      await refreshDeviceCatalog()
      return installed
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error
          ? `加载设备卡失败：${error.message}`
          : '加载设备卡失败，请重新打开自定义卡片。'
      })
      return []
    } finally {
      setLoading(false)
    }
  }, [desktopApi, refreshDeviceCatalog])

  /**
   * 独立刷新本机 Agent CLI 与 Bridge 状态，不阻塞卡片库。
   *
   * @returns 状态读取结束后更新 Agent 快照或独立错误。
   */
  const refreshAgentInfo = useCallback(async (): Promise<void> => {
    if (!desktopApi) {
      setAgentInfo(null)
      setAgentLoading(false)
      return
    }
    setAgentLoading(true)
    setAgentError(null)
    try {
      setAgentInfo(await desktopApi.agent.getInfo())
    } catch (error) {
      setAgentInfo(null)
      setAgentError(error instanceof Error
        ? error.message
        : '无法读取本机 Agent 环境。')
    } finally {
      setAgentLoading(false)
    }
  }, [desktopApi])

  useEffect(() => {
    void refresh()
    void refreshAgentInfo()
    return () => {
      void desktopApi?.close()
    }
  }, [desktopApi, refresh, refreshAgentInfo])

  useEffect(() => {
    const subscription = services.workflow.subscribeWorkflowRuntime(event => {
      if (event.event === 'device.catalog.changed') {
        void refreshDeviceCatalog()
      }
    })
    return () => subscription.dispose()
  }, [refreshDeviceCatalog, services.workflow])

  useEffect(() => services.realtime.subscribeDeviceStatus({
    onDeviceStatus: statuses => {
      const next = new Map(statusMapRef.current)
      for (const status of statuses) next.set(status.deviceId, status)
      statusMapRef.current = next
      setStatusMap(next)
    },
    onError: error => {
      setMessage(current => current?.kind === 'error'
        ? current
        : { kind: 'warning', text: `${error}，Live 状态可能暂时不更新。` })
    }
  }), [services.realtime])

  useEffect(() => {
    if (!desktopApi) return
    return desktopApi.workspace.onStatus(setWorkspace)
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    let receivedSinceLog = 0
    let lastLoggedAt = 0
    console.info('[joint-preview] stage=workbench status=listener_ready surface=theia')
    return desktopApi.onJointPreview((frame) => {
      try {
        const accepted = publishJointStateFrame({ ...frame, source: 'mock' })
        receivedSinceLog += 1
        const now = Date.now()
        if (lastLoggedAt === 0 || now - lastLoggedAt >= 1_000) {
          console.info(
            `[joint-preview] stage=workbench status=${accepted.updatedAt > frame.updatedAt ? 'stale' : 'published'} surface=theia material=${jointPreviewDiagnosticToken(frame.materialId)} joints=${Object.keys(frame.jointStates).length} events=${receivedSinceLog}`
          )
          receivedSinceLog = 0
          lastLoggedAt = now
        }
      } catch (error) {
        console.error(
          `[joint-preview] stage=workbench status=rejected surface=theia material=${jointPreviewDiagnosticToken(frame.materialId)} reason=invalid_frame`,
          error
        )
      }
    })
  }, [desktopApi])

  useEffect(() => {
    if (!desktopApi) return
    return desktopApi.authoring.onTargetRequest(request => {
      void services.laboratory.getDeviceCatalog().then(
        catalog => desktopApi.authoring.resolveTargetRequest({
          requestId: request.requestId,
          ok: true,
          targets: catalog.filter(device => device.definition).map(device => buildWorkbenchDeviceCardAuthoringTarget(
            device,
            buildWorkbenchDeviceCardRuntimeState(device, statusMapRef.current)
          ))
        }),
        (error: unknown) => desktopApi.authoring.resolveTargetRequest({
          requestId: request.requestId,
          ok: false,
          message: error instanceof Error
            ? error.message
            : '无法读取 OS 设备目录。'
        })
      )
    })
  }, [desktopApi, services.laboratory])

  const selectedCard = cards.find(card => card.key === selectedCardKey)
  const selectedDevice = devices.find(device => device.deviceId === selectedDeviceId)
    ?? devices[0]
  const workspaceCard = workspace?.card
  const workspaceActive = workspace !== null
  const previewCard = workspaceCard ?? selectedCard
  const previewDevice = selectedDevice && previewCard && deviceCardSupportsDevice(
    previewCard,
    selectedDevice.definitionFqid,
    selectedDevice.deviceTypeId
  ) ? selectedDevice : undefined
  const previewId = workspaceCard
    ? `workspace:${workspaceCard.sourceHash}`
    : selectedCard
      ? `installed:${selectedCard.key}`
      : ''
  const previewDeviceId = previewDevice?.deviceId ?? ''
  const liveMode = isWorkbenchDeviceCardLiveBinding(
    liveBinding,
    previewId,
    previewDeviceId
  )

  useEffect(() => {
    if (liveMode && previewDevice?.materialUuid) {
      clearJointStateFrame(previewDevice.materialUuid)
    }
  }, [liveMode, previewDevice?.materialUuid])

  useEffect(() => {
    setSelectedDeviceId(current => devices.some(device => device.deviceId === current)
      ? current
      : devices[0]?.deviceId ?? '')
  }, [devices])

  useEffect(() => {
    if (!previewCard) return
    setSelectedDeviceId(current => {
      const currentDevice = devices.find(device => device.deviceId === current)
      if (currentDevice && deviceCardSupportsDevice(
        previewCard,
        currentDevice.definitionFqid,
        currentDevice.deviceTypeId
      )) {
        return current
      }
      return devices.find(device => deviceCardSupportsDevice(
        previewCard,
        device.definitionFqid,
        device.deviceTypeId
      ))?.deviceId ?? current
    })
  }, [devices, previewCard])

  devicesRef.current = devices

  useEffect(() => {
    if (!liveBinding || isWorkbenchDeviceCardLiveBinding(
      liveBinding,
      previewId,
      previewDeviceId
    )) return
    void desktopApi?.close()
    setLiveBinding(null)
  }, [desktopApi, liveBinding, previewDeviceId, previewId])

  const runtimeState = useMemo<Record<string, unknown>>(
    () => selectedDevice
      ? buildWorkbenchDeviceCardRuntimeState(selectedDevice, statusMap)
      : { status: 'idle', online: false },
    [selectedDevice, statusMap]
  )
  const mockState = useMemo<Record<string, unknown>>(
    () => previewDevice
      ? buildWorkbenchDeviceCardSampleState(previewDevice, { online: false })
      : { status: 'idle', online: false },
    [previewDevice]
  )
  const activePreviewState = liveMode && previewDevice
    ? runtimeState
    : mockState
  runtimeStateRef.current = activePreviewState

  const actionSignature = workbenchDeviceCardActionSignature(
    previewDevice?.actions ?? []
  )
  const actionContracts = useMemo<DeviceCardActionContract[]>(
    () => JSON.parse(actionSignature) as DeviceCardActionContract[],
    [actionSignature]
  )
  const stateKeys = previewDevice
    ? deviceCardRealtimeStateKeys({
        ...(previewDevice.stateSchema ?? {}),
        ...DEVICE_CARD_HOST_STATE_SCHEMA
      })
    : []
  const stateSignature = stateKeys.join('\u0000')

  useEffect(() => {
    if (
      loading
      || !active
      || !desktopApi
      || !previewCard
      || !previewRef.current
    ) return
    const preview = previewRef.current
    let disposed = false
    const syncBounds = (): void => {
      const rect = preview.getBoundingClientRect()
      void desktopApi.updateBounds({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
      }).catch(error => {
        if (!disposed) setMessage(workbenchDeviceCardErrorNotice(
          error,
          '更新卡片预览尺寸失败'
        ))
      })
    }
    const observer = new ResizeObserver(syncBounds)
    observer.observe(preview)
    const frame = requestAnimationFrame(() => {
      const rect = preview.getBoundingClientRect()
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
          deviceId: liveMode ? previewDeviceId : null,
          materialId: previewDevice?.materialUuid ?? null,
          definitionFqid: previewDevice?.definitionFqid
            ?? previewCard.definitionFqids[0]
            ?? '',
          ...(previewDevice?.definition
            ? { definition: previewDevice.definition }
            : {}),
          deviceTypeId: previewDevice?.definitionFqid
            ?? previewCard.definitionFqids[0]
            ?? previewDevice?.deviceTypeId
            ?? previewCard.legacyDeviceTypes[0]
            ?? '',
          title: previewDevice?.label ?? previewCard.title
        },
        state: runtimeStateRef.current,
        config: {},
        ...(jointPreview ? { jointPreview } : {}),
        theme: resolveWorkbenchDeviceCardTheme(),
        locale: 'zh-CN'
      }
      const request = {
        bounds: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        },
        context,
        availableActions: previewDevice ? actionContracts : undefined,
        availableState: liveMode ? stateKeys : undefined,
        availableMedia: liveMode ? [] : undefined
      }
      const opening = workspaceActive
        ? desktopApi.workspace.preview(request)
        : desktopApi.open({ ...request, key: selectedCard?.key ?? '' })
      void opening.catch(error => {
        if (!disposed) setMessage(workbenchDeviceCardErrorNotice(
          error,
          '打开卡片预览失败'
        ))
      })
    })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      void desktopApi.close()
    }
  }, [
    actionContracts,
    actionSignature,
    active,
    desktopApi,
    liveMode,
    loading,
    previewCard,
    previewDevice,
    previewDeviceId,
    selectedCard?.key,
    stateSignature,
    workspaceActive
  ])

  useEffect(() => {
    if (!active || !desktopApi || !previewCard) return
    void desktopApi.updateState(activePreviewState).catch(error => {
      setMessage(workbenchDeviceCardErrorNotice(error, '同步卡片状态失败'))
    })
  }, [active, activePreviewState, desktopApi, previewCard])

  useEffect(() => {
    if (!desktopApi) return
    const abortController = new AbortController()
    const controller = new DeviceCardActionController({
      workflow: services.workflow,
      tasks: services.deviceActionTasks,
      actionTasksSupported: services.capabilities.devices.runActionTask
    })
    const unsubscribe = desktopApi.onActionRequest(request => {
      const device = devicesRef.current.find(
        candidate => candidate.deviceId === request.deviceId
      )
      const running = device
        ? controller.execute(request, device, { signal: abortController.signal })
        : Promise.resolve<DeviceCardActionRun>({
            requestId: request.requestId,
            action: request.action,
            status: 'ERROR',
            error: `未找到设备：${request.deviceId}`
          })
      void running.then(run => desktopApi.resolveAction(run)).catch(error => {
        setMessage(workbenchDeviceCardErrorNotice(
          error,
          '回传设备动作结果失败'
        ))
      })
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

  const actions = useWorkbenchDeviceCardActions({
    desktopApi,
    fileApi: bridge.file,
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
  })

  /** 在 Mock 与用户明确确认的 Live 设备绑定之间切换。 */
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
        text: `设备 ${previewDevice.deviceId} 当前离线，不能建立 Live 绑定。`
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
    setLiveBinding({ previewId, deviceId: previewDevice.deviceId })
    setMessage({
      kind: 'warning',
      text: drifted
        ? `设备定义已更新，已按当前能力重新校验并应用到 ${previewDevice.deviceId}。`
        : `已明确应用到 ${previewDevice.deviceId}；卡片现在可以调用该设备声明的动作。`
    })
  }

  return {
    ...actions,
    agentError,
    agentInfo,
    agentLoading,
    agentReady,
    authoringProfile,
    cards,
    desktopAvailable: Boolean(desktopApi),
    devices,
    fileAvailable: Boolean(bridge.file),
    liveMode,
    loading,
    message,
    previewCard,
    previewDescription: describePreview(
      workspace,
      previewCard,
      previewDevice,
      selectedDevice,
      liveMode
    ),
    previewDevice,
    previewRef,
    selectedCardKey,
    selectedDevice,
    refreshAgentInfo,
    setAuthoringProfile,
    setSelectedCardKey,
    setSelectedDeviceId,
    toggleLiveBinding,
    workspace
  }
}

function jointPreviewDiagnosticToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:@-]+/gu, '_').slice(0, 160)
}

/**
 * 生成预览标题下方的绑定和来源说明。
 *
 * @param workspace 当前源码工作区。
 * @param previewCard 当前预览卡片。
 * @param previewDevice 与卡片类型兼容的设备。
 * @param selectedDevice 用户选择的设备。
 * @param liveMode 是否已明确建立 Live 绑定。
 * @returns 紧凑、可读的中文预览说明。
 */
function describePreview(
  workspace: DeviceCardWorkspaceStatus | null,
  previewCard: DeviceCardWorkspaceStatus['card'] | InstalledDeviceCard | undefined,
  previewDevice: DeviceCatalogItem | undefined,
  selectedDevice: DeviceCatalogItem | undefined,
  liveMode: boolean
): string {
  if (workspace?.state === 'building') return '开发预览 · 正在检查源码'
  if (workspace?.state === 'error') {
    return workspace.card ? '开发预览 · 上次成功版本 · Mock' : '开发预览不可用'
  }
  if (liveMode && previewDevice) return `Live · ${previewDevice.deviceId}`
  if (previewDevice) return `Mock · 可应用到 ${previewDevice.deviceId}`
  if (previewCard && selectedDevice) {
    return `Mock · 不支持设备定义 ${
      selectedDevice.definitionFqid ?? selectedDevice.deviceTypeId
    }`
  }
  return previewCard ? 'Mock · 未绑定设备' : '选择或创建一张设备卡开始预览'
}

/**
 * 根据 Theia 当前主题选择设备卡 Host Bridge 主题。
 *
 * @returns 与工作台一致的 light 或 dark 主题标识。
 */
function resolveWorkbenchDeviceCardTheme(): 'light' | 'dark' {
  return document.body.classList.contains('theia-dark')
    || document.documentElement.classList.contains('theia-dark')
    ? 'dark'
    : 'light'
}
