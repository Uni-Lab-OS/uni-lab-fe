import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  DeviceCardActionController,
  useServices,
  type DeviceCatalogItem
} from '@unilab/services'
import { createDeviceCardAuthoringKit } from '@unilab/device-card-authoring-kit'
import {
  DEVICE_CARD_HOST_STATE_SCHEMA,
  deviceCardRealtimeStateKeys
} from '@unilab/device-card-sdk'
import type {
  DeviceCardActionRun,
  DeviceCardActionContract,
  DeviceCardAgentEnvironmentInfo,
  DeviceCardAuthoringProfile,
  DeviceCardRuntimeSnapshot,
  DeviceCardWorkspaceStatus,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'

import {
  buildAuthoringSampleState,
  createAuthoringContext
} from '../../data/authoringContext'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import styles from './DeviceCardWorkbench.module.scss'
import { deviceInstanceOptionLabel } from './presentation'
import {
  deviceCardActionContractSignature,
  isDeviceCardLiveBinding,
  type DeviceCardLiveBinding
} from './runtimeBinding'
import { buildDeviceCardRuntimeState } from './runtimeState'

type WorkbenchNotice = {
  kind: 'success' | 'warning' | 'error' | 'info'
  text: string
}

export default function DeviceCardWorkbench(): React.JSX.Element {
  const services = useServices()
  const desktopApi = window.api?.deviceCards
  const fileApi = window.api?.file
  const { statusMap } = useDeviceStatus()
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
  const [exportingKit, setExportingKit] = useState(false)
  const [workspace, setWorkspace] =
    useState<DeviceCardWorkspaceStatus | null>(null)
  const [agentInfo, setAgentInfo] =
    useState<DeviceCardAgentEnvironmentInfo | null>(null)
  const [workspaceOperation, setWorkspaceOperation] = useState<
    'open' | 'prepare' | 'rebuild' | 'install' | 'close' | 'cli' | null
  >(null)
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

  const selectedCard = cards.find((card) => card.key === selectedCardKey)
  const selectedDevice = devices.find(
    (device) => device.deviceId === selectedDeviceId
  ) ?? devices[0]
  const workspaceCard = workspace?.card
  const workspaceActive = workspace !== null
  const previewCard = workspaceCard ?? selectedCard
  const previewDevice = selectedDevice && previewCard?.deviceTypes.includes(
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
  const previewFallbackDeviceTypeId = previewCard?.deviceTypes[0] ?? ''
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
  const agentReady = Boolean(
    agentInfo?.bridge.enabled &&
    agentInfo.cli.installed &&
    agentInfo.cli.compatible
  )

  useEffect(() => {
    setSelectedDeviceId((current) =>
      devices.some((device) => device.deviceId === current)
        ? current
        : devices[0]?.deviceId ?? ''
    )
  }, [devices])

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
    const context: DeviceCardRuntimeSnapshot = {
      mode: liveMode ? 'live' : 'mock',
      device: {
        deviceId: liveMode ? previewDeviceId : null,
        deviceTypeId:
          previewDeviceTypeId || previewFallbackDeviceTypeId,
        title: previewDeviceLabel || previewCardTitle
      },
      state: runtimeStateRef.current,
      config: {},
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
    previewDeviceTypeId,
    previewFallbackDeviceTypeId,
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

  const openWorkspace = async (): Promise<void> => {
    if (!desktopApi || !selectedDevice) return
    setWorkspaceOperation('open')
    setMessage(null)
    try {
      const status = await desktopApi.workspace.open(
        createAuthoringContext(selectedDevice, runtimeState)
      )
      if (!status) return
      setWorkspace(status)
      setMessage(status.state === 'ready'
        ? {
            kind: 'success',
            text: '源码目录已授权，Electron 将在保存后自动检查并刷新预览。'
          }
        : {
            kind: 'warning',
            text: '源码目录已打开，请按结构化诊断修复当前错误。'
          })
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '打开已有项目失败'
      })
    } finally {
      setWorkspaceOperation(null)
    }
  }

  const prepareAgentProject = async (): Promise<void> => {
    if (!desktopApi || !selectedDevice) return
    setWorkspaceOperation('prepare')
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
          ? '项目已创建并检查通过，可以交给 AI 修改。'
          : '项目已创建，请让 AI 根据诊断继续修复。'
      })
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '创建 Agent 项目失败'
      })
    } finally {
      setWorkspaceOperation(null)
    }
  }

  const toggleAgentCli = async (): Promise<void> => {
    if (!desktopApi || !agentInfo) return
    setWorkspaceOperation('cli')
    setMessage(null)
    try {
      const next = agentInfo.cli.installed && agentInfo.cli.compatible
        ? await desktopApi.agent.removeCli()
        : await desktopApi.agent.installCli()
      setAgentInfo(next)
      setMessage({
        kind: 'success',
        text: next.cli.installed
          ? `AI 助手连接工具已安装：${next.cli.installPath}`
          : 'AI 助手连接工具已移除。'
      })
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '更新 Agent CLI 失败'
      })
    } finally {
      setWorkspaceOperation(null)
    }
  }

  const toggleAgentBridge = async (): Promise<void> => {
    if (!desktopApi || !agentInfo) return
    setWorkspaceOperation('cli')
    setMessage(null)
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
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '更新 AI 助手连接失败'
      })
    } finally {
      setWorkspaceOperation(null)
    }
  }

  const copyAgentPrompt = async (): Promise<void> => {
    if (!workspace || !agentReady || !agentInfo) return
    const command = [
      quoteCommand(agentInfo.cli.command),
      'workspace status',
      '--project',
      quoteCommand(workspace.projectDir),
      '--json'
    ].join(' ')
    const prompt = [
      `请开发 ${workspace.projectDir} 中的 Uni-Lab 设备卡片。`,
      '先完整阅读 AGENTS.md、CARD_SPEC.md、authoring-context.json、card.manifest.json 和 mock.json；仅按声明的设备能力修改 src，设计专业的实验室界面。禁止安装依赖、使用网络、Node.js 或未声明的状态和 Action。',
      '只有 authoring-context.json 中经 SDK 判定为正式可订阅的 Driver/Host 状态键才能进入状态权限和实时面板；Action 输出以及 action-inferred、runtime-sample、unresolved 字段不是实时状态。',
      '运行时只允许通过 Host Bridge 读取当前 deviceId 的状态并调用 Action，禁止直连设备或 WebSocket。Action 输入只是草稿，实时值必须等待设备上报；切换实例不得沿用旧值。处理离线、忙碌、失败、未上报及 Mock/Live 模式。',
      `每次修改后运行：\n${command}\n失败时读取 .unilab-card/diagnostics.json 并修复到 ready。不要安装卡片或调用真实设备 Action。`
    ].join('\n\n')
    try {
      await navigator.clipboard.writeText(prompt)
      setMessage({
        kind: 'success',
        text: 'AI 开发指令已复制'
      })
    } catch {
      setMessage({
        kind: 'warning',
        text: '自动复制失败，请在项目目录中打开后重试。'
      })
    }
  }

  const rebuildWorkspace = async (): Promise<void> => {
    if (!desktopApi || !workspace) return
    setWorkspaceOperation('rebuild')
    setMessage(null)
    try {
      const status = await desktopApi.workspace.rebuild()
      setWorkspace(status)
      setMessage(status.state === 'ready'
        ? {
            kind: 'success',
            text: '当前源码检查通过，开发预览已刷新。'
          }
        : {
            kind: 'warning',
            text: '当前源码仍有错误，请查看诊断。'
          })
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '重新检查失败'
      })
    } finally {
      setWorkspaceOperation(null)
    }
  }

  const installWorkspace = async (): Promise<void> => {
    if (!desktopApi || workspace?.state !== 'ready') return
    setWorkspaceOperation('install')
    setMessage(null)
    try {
      const installed = await desktopApi.workspace.install()
      await refresh()
      setSelectedCardKey(installed.key)
      setMessage({
        kind: 'success',
        text: `已从当前源码快照权威构建并安装：${installed.title}`
      })
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '安装当前源码失败'
      })
    } finally {
      setWorkspaceOperation(null)
    }
  }

  const closeWorkspace = async (): Promise<void> => {
    if (!desktopApi || !workspace) return
    setWorkspaceOperation('close')
    setMessage(null)
    try {
      await desktopApi.workspace.close()
      setWorkspace(null)
      setMessage({ kind: 'info', text: '本地开发工作区已关闭。' })
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '关闭工作区失败'
      })
    } finally {
      setWorkspaceOperation(null)
    }
  }

  const exportAuthoringKit = async (): Promise<void> => {
    if (!fileApi || !selectedDevice) return
    setExportingKit(true)
    setMessage(null)
    try {
      const kit = await createDeviceCardAuthoringKit({
        context: createAuthoringContext(selectedDevice, runtimeState),
        profile: authoringProfile
      })
      const saved = await fileApi.saveBinary({
        defaultName: kit.fileName,
        content: kit.archive
      })
      if (saved) {
        setMessage({
          kind: 'success',
          text: `卡片开发包已保存：${saved.path}`
        })
      }
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error
          ? error.message
          : '导出卡片开发包失败'
      })
    } finally {
      setExportingKit(false)
    }
  }

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
    setLiveBinding({
      previewId,
      deviceId: previewDevice.deviceId
    })
    setMessage({
      kind: 'warning',
      text: `已明确应用到 ${previewDevice.deviceId}。Live 卡片可以调用该设备声明的 Action。`
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
      ? `Mock 模式 / 不支持 ${selectedDevice.deviceTypeId}`
      : 'Mock 模式 / 未绑定设备'
  })()

  if (!desktopApi) {
    return (
      <section className={styles.unavailable}>
        <h1>设备自定义卡片</h1>
        <p>源码目录预览与安装仅在 Electron 桌面端可用。</p>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <aside className={styles.sidebar}>
        <header className={styles.sidebarHeader}>
          <div>
            <h1>设备卡片</h1>
            <span>{cards.length} 张已安装</span>
          </div>
          <p>创建和预览设备操作界面。</p>
        </header>

        {message ? (
          <p
            className={`${styles.message} ${
              styles[`message_${message.kind}`]
            }`}
            role={message.kind === 'error' ? 'alert' : 'status'}
            aria-live={message.kind === 'error' ? 'assertive' : 'polite'}
          >
            {message.text}
          </p>
        ) : null}

        {workspace ? (
          <section className={styles.workspace} aria-label="本地开发工作区">
            <div className={styles.workspaceHeading}>
              <div>
                <span>当前项目</span>
                <strong>{workspace.projectName}</strong>
              </div>
              <span
                className={`${styles.workspaceState} ${
                  styles[`workspaceState_${workspace.state}`]
                }`}
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-label={
                  `${workspaceStateLabel(workspace.state)}。${
                    workspaceSummary(workspace)
                  }`
                }
              >
                {workspaceStateLabel(workspace.state)}
              </span>
            </div>
            <div className={styles.projectPath}>
              <code title={workspace.projectDir}>{workspace.projectDir}</code>
            </div>
            <p className={styles.workspaceSummary}>
              {workspaceSummary(workspace)}
            </p>
            {workspace.diagnostics.length > 0 ? (
              <ul className={styles.diagnostics}>
                {workspace.diagnostics.slice(0, 3).map((diagnostic, index) => (
                  <li
                    key={`${diagnostic.code}-${diagnostic.path ?? index}`}
                    className={styles[`diagnostic_${diagnostic.severity}`]}
                  >
                    <strong>{diagnostic.code}</strong>
                    <span>
                      {diagnostic.path ? `${diagnostic.path} · ` : ''}
                      {diagnostic.message}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className={styles.projectActions}>
              <button
                type="button"
                disabled={!agentReady || workspaceOperation !== null}
                onClick={() => void copyAgentPrompt()}
              >
                {agentReady ? '复制 AI 指令' : '请先设置 AI 助手'}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => void desktopApi.authoring.reveal(
                  workspace.projectDir
                )}
              >
                打开文件夹
              </button>
            </div>
            <div className={styles.workspaceActions}>
              <button
                type="button"
                className={styles.secondary}
                disabled={workspaceOperation !== null}
                onClick={() => void rebuildWorkspace()}
              >
                {workspaceOperation === 'rebuild' ? '检查中…' : '重新检查'}
              </button>
              <button
                type="button"
                disabled={
                  workspace.state !== 'ready' || workspaceOperation !== null
                }
                onClick={() => void installWorkspace()}
              >
                {workspaceOperation === 'install' ? '安装中…' : '确认并安装'}
              </button>
              <button
                type="button"
                className={styles.ghost}
                disabled={workspaceOperation !== null}
                onClick={() => void closeWorkspace()}
              >
                关闭工作区
              </button>
            </div>
          </section>
        ) : (
          <>
            <section className={styles.creationFlow} aria-label="开始卡片开发">
              <h2>开始开发</h2>

              <div className={styles.fieldGroup}>
                <label>
                  目标设备
                  <select
                    value={selectedDevice?.deviceId ?? ''}
                    onChange={(event) => setSelectedDeviceId(event.target.value)}
                    disabled={devices.length === 0}
                  >
                    {devices.length === 0 ? (
                      <option value="">没有可用设备</option>
                    ) : null}
                    {devices.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {deviceInstanceOptionLabel(device)}
                      </option>
                    ))}
                  </select>
                </label>

                <label>
                  开发框架
                  <select
                    value={authoringProfile}
                    onChange={(event) => setAuthoringProfile(
                      event.target.value as DeviceCardAuthoringProfile
                    )}
                  >
                    <option value="vue-web-component-v1">Vue 3</option>
                    <option value="react-web-component-v1">React</option>
                    <option value="web-component-lite-v1">Web Component Lite</option>
                  </select>
                </label>
              </div>

              <div className={styles.creationActions}>
                <button
                  type="button"
                  disabled={!selectedDevice || workspaceOperation !== null}
                  aria-busy={workspaceOperation === 'prepare'}
                  onClick={() => void prepareAgentProject()}
                >
                  {workspaceOperation === 'prepare' ? '正在创建…' : '新建项目'}
                </button>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={!selectedDevice || workspaceOperation !== null}
                  aria-busy={workspaceOperation === 'open'}
                  onClick={() => void openWorkspace()}
                >
                  {workspaceOperation === 'open' ? '正在打开…' : '打开项目'}
                </button>
              </div>

              <button
                type="button"
                className={styles.textButton}
                disabled={!selectedDevice || !fileApi || exportingKit}
                onClick={() => void exportAuthoringKit()}
              >
                {exportingKit ? '正在导出…' : '导出离线开发包'}
              </button>
            </section>

            <section className={styles.libraryPicker} aria-label="已安装卡片预览">
              <label>
                预览已安装卡片
                <select
                  value={selectedCardKey}
                  onChange={(event) => setSelectedCardKey(event.target.value)}
                  disabled={cards.length === 0}
                >
                  {cards.length === 0 ? <option value="">尚未安装卡片</option> : null}
                  {cards.map((card) => (
                    <option key={card.key} value={card.key}>
                      {card.title} / {card.version}
                    </option>
                  ))}
                </select>
              </label>
            </section>
          </>
        )}

        {agentInfo ? (
          <details className={styles.agentTools}>
            <summary>
              <strong>AI 助手</strong>
              <b data-ready={agentReady}>
                {agentStatusLabel(agentInfo)}
              </b>
            </summary>
            <div className={styles.agentToolsBody}>
              <p>供本机 AI 读取项目和检查结果，不能控制真实设备。</p>
              <div className={styles.agentActions}>
                {!agentInfo.cli.compatible ? (
                  <button
                    type="button"
                    disabled={workspaceOperation !== null}
                    onClick={() => void toggleAgentCli()}
                  >
                    {workspaceOperation === 'cli'
                      ? '处理中…'
                      : agentInfo.cli.installed
                        ? '更新工具'
                        : '安装工具'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={workspaceOperation !== null}
                    onClick={() => void toggleAgentBridge()}
                  >
                    {workspaceOperation === 'cli'
                      ? '处理中…'
                      : agentInfo.bridge.enabled
                        ? '停止连接'
                        : '启用连接'}
                  </button>
                )}
                {agentInfo.cli.installed && agentInfo.cli.compatible ? (
                  <button
                    type="button"
                    className={styles.secondary}
                    disabled={workspaceOperation !== null}
                    onClick={() => void toggleAgentCli()}
                  >
                    移除工具
                  </button>
                ) : null}
              </div>
            </div>
          </details>
        ) : null}
      </aside>

      <main className={styles.main}>
        <header className={styles.previewHeader}>
          <div>
            <strong>{previewCard?.title ?? '卡片预览'}</strong>
            <span>{previewDescription}</span>
          </div>
          {previewCard && previewDevice ? (
            <div className={styles.liveControls}>
              <span className={styles.modeBadge} data-live={liveMode}>
                {liveMode ? 'LIVE' : 'MOCK'}
              </span>
              <button
                type="button"
                className={liveMode ? styles.stopLive : styles.applyLive}
                disabled={!liveMode && !previewDevice.online}
                aria-pressed={liveMode}
                onClick={toggleLiveBinding}
              >
                {liveMode
                  ? '退出 Live'
                  : `应用到 ${previewDevice.deviceId}`}
              </button>
            </div>
          ) : null}
        </header>
        <div ref={previewRef} className={styles.preview}>
          {!previewCard ? (
            <div className={styles.empty}>
              {workspace
                ? '修复左侧显示的问题后，预览会自动更新。'
                : '创建项目或选择一张已安装卡片后，可在这里预览。'}
            </div>
          ) : null}
        </div>
      </main>
    </section>
  )
}

function workspaceStateLabel(
  state: DeviceCardWorkspaceStatus['state']
): string {
  if (state === 'ready') return '检查通过'
  if (state === 'error') return '需要修复'
  return '正在检查'
}

function quoteCommand(value: string): string {
  return `"${value.replaceAll('"', '\\"')}"`
}

function workspaceSummary(workspace: DeviceCardWorkspaceStatus): string {
  const errors = workspace.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  ).length
  const warnings = workspace.diagnostics.length - errors
  if (workspace.state === 'building') {
    return workspace.card
      ? '正在检查最新修改，右侧暂时保留上次成功预览。'
      : '正在进行第一次源码检查，通过后会自动显示预览。'
  }
  if (workspace.state === 'ready') {
    return warnings > 0
      ? `检查通过，仍有 ${warnings} 条提醒。请确认预览后再安装。`
      : '检查通过。请先确认右侧预览，满意后再安装。'
  }
  return `发现 ${errors} 个问题。修复前不能安装。`
}

function agentStatusLabel(
  info: DeviceCardAgentEnvironmentInfo
): string {
  if (!info.cli.installed) return '未安装'
  if (!info.cli.compatible) return '需更新'
  if (!info.bridge.enabled) return '未启用'
  return '已连接'
}
