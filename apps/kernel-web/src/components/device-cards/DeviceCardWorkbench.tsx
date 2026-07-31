import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  useServices,
  type DeviceCatalogItem
} from '@unilab/services'
import { createDeviceCardAuthoringKit } from '@unilab/device-card-authoring-kit'
import type {
  DeviceCardActionRun,
  DeviceCardAuthoringProfile,
  DeviceCardHostActionRequest,
  DeviceCardRuntimeSnapshot,
  DeviceCardWorkspaceStatus,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'

import { createAuthoringContext } from '../../data/authoringContext'
import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import styles from './DeviceCardWorkbench.module.scss'
import { deviceInstanceOptionLabel } from './presentation'

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
  const [cards, setCards] = useState<InstalledDeviceCard[]>([])
  const [devices, setDevices] = useState<DeviceCatalogItem[]>([])
  const [selectedCardKey, setSelectedCardKey] = useState('')
  const [selectedDeviceId, setSelectedDeviceId] = useState('')
  const [authoringProfile, setAuthoringProfile] =
    useState<DeviceCardAuthoringProfile>('vue-web-component-v1')
  const [loading, setLoading] = useState(false)
  const [exportingKit, setExportingKit] = useState(false)
  const [workspace, setWorkspace] =
    useState<DeviceCardWorkspaceStatus | null>(null)
  const [workspaceOperation, setWorkspaceOperation] = useState<
    'open' | 'rebuild' | 'install' | 'close' | null
  >(null)
  const [message, setMessage] = useState<WorkbenchNotice | null>(null)

  const refresh = useCallback(async () => {
    if (!desktopApi) return
    setLoading(true)
    setMessage(null)
    try {
      const [installed, catalog, workspaceStatus] = await Promise.all([
        desktopApi.list(),
        services.laboratory.getDeviceCatalog().catch(() => []),
        desktopApi.workspace.get()
      ])
      setCards(installed)
      setDevices(catalog)
      setWorkspace(workspaceStatus)
      setSelectedCardKey((current) =>
        installed.some((card) => card.key === current)
          ? current
          : installed[0]?.key ?? ''
      )
    } catch (error) {
      setMessage({
        kind: 'error',
        text: error instanceof Error ? error.message : '加载设备卡片失败'
      })
    } finally {
      setLoading(false)
    }
  }, [desktopApi, services.laboratory])

  useEffect(() => {
    void refresh()
    return () => {
      void desktopApi?.close()
    }
  }, [desktopApi, refresh])

  useEffect(() => {
    if (!desktopApi) return
    return desktopApi.workspace.onStatus(setWorkspace)
  }, [desktopApi])

  const selectedCard = cards.find((card) => card.key === selectedCardKey)
  const selectedDevice = devices.find(
    (device) => device.deviceId === selectedDeviceId
  ) ?? devices[0]
  const workspaceCard = workspace?.card
  const workspaceActive = workspace !== null
  const previewCard = workspaceCard ?? selectedCard
  const compatibleDevice = selectedDevice && previewCard?.deviceTypes.includes(
    selectedDevice.deviceTypeId
  )
    ? selectedDevice
    : undefined
  // 有兼容设备就 Live 绑定（含源码目录预览），与仪器单点同一条下发路径。
  const previewDevice = compatibleDevice

  useEffect(() => {
    setSelectedDeviceId((current) =>
      devices.some((device) => device.deviceId === current)
        ? current
        : devices[0]?.deviceId ?? ''
    )
  }, [devices])

  const runtimeState = useMemo<Record<string, unknown>>(() => {
    if (!selectedDevice) return { status: 'idle', online: false }
    const live = statusMap.get(selectedDevice.deviceId)?.status ?? {}
    // Edge /api/v1/ws/device_status 真值；online / actionBusy 仍来自目录。
    return {
      ...live,
      online: selectedDevice.online,
      actionBusy: Object.fromEntries(
        selectedDevice.actions.map((action) => [
          action.actionName,
          action.isBusy
        ])
      )
    }
  }, [selectedDevice, statusMap])
  const previewState = useMemo<Record<string, unknown>>(
    () => (previewDevice ? runtimeState : { status: 'idle', online: false }),
    [previewDevice, runtimeState]
  )
  runtimeStateRef.current = previewState

  useEffect(() => {
    if (!desktopApi || !previewCard || !previewRef.current) return
    const preview = previewRef.current
    let disposed = false
    const context: DeviceCardRuntimeSnapshot = {
      mode: previewDevice ? 'live' : 'mock',
      device: {
        deviceId: previewDevice?.deviceId ?? null,
        deviceTypeId:
          previewDevice?.deviceTypeId ?? previewCard.deviceTypes[0] ?? '',
        title: previewDevice?.label ?? previewCard.title
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
        availableActions: previewDevice?.actions.map(
          (action) => action.actionName
        )
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
    previewDevice,
    selectedCard?.key,
    selectedDevice?.deviceId,
    workspaceActive,
    workspaceCard?.sourceHash
  ])

  useEffect(() => {
    if (!desktopApi || !previewCard) return
    void desktopApi.updateState(previewState)
  }, [desktopApi, previewCard, previewState])

  useEffect(() => {
    if (!desktopApi) return
    return desktopApi.onActionRequest((request) => {
      void submitAction(request, services.laboratory, desktopApi.resolveAction)
    })
  }, [desktopApi, services.laboratory])

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
        text: error instanceof Error ? error.message : '打开源码目录失败'
      })
    } finally {
      setWorkspaceOperation(null)
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
        <header>
          <div>
            <h1>设备卡片</h1>
            <p>{cards.length} 个已安装 Artifact</p>
          </div>
        </header>

        <div className={styles.primaryActions}>
          <button
            type="button"
            disabled={!selectedDevice || workspaceOperation !== null}
            aria-busy={workspaceOperation === 'open'}
            onClick={() => void openWorkspace()}
          >
            {workspaceOperation === 'open' ? '正在打开…' : '打开源码目录'}
          </button>
        </div>

        {workspace ? (
          <section className={styles.workspace} aria-label="本地开发工作区">
            <div className={styles.workspaceHeading}>
              <strong>{workspace.projectName}</strong>
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
            <code title={workspace.projectDir}>{workspace.projectDir}</code>
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
                {workspaceOperation === 'install' ? '安装中…' : '安装当前源码'}
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
        ) : null}

        <label>
          已安装卡片
          <select
            value={selectedCardKey}
            onChange={(event) => setSelectedCardKey(event.target.value)}
            disabled={loading || cards.length === 0}
          >
            {cards.length === 0 ? <option value="">尚未安装</option> : null}
            {cards.map((card) => (
              <option key={card.key} value={card.key}>
                {card.title} · {card.version}
              </option>
            ))}
          </select>
        </label>

        <label>
          设备实例
          <select
            value={selectedDevice?.deviceId ?? ''}
            onChange={(event) => setSelectedDeviceId(event.target.value)}
            disabled={devices.length === 0}
          >
            {devices.length === 0 ? (
              <option value="">尚无可创作设备</option>
            ) : null}
            {devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceInstanceOptionLabel(device)}
              </option>
            ))}
          </select>
        </label>

        <label>
          创作框架
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

        <button
          type="button"
          className={styles.secondary}
          disabled={!selectedDevice || !fileApi || exportingKit}
          onClick={() => void exportAuthoringKit()}
        >
          {exportingKit ? '正在生成…' : '导出卡片开发包'}
        </button>

        <div className={styles.security}>
          <strong>隔离策略</strong>
          <span>WebContentsView · sandbox · contextIsolation</span>
          <span>网络禁用 · Node 禁用 · Action 白名单</span>
        </div>
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
      </aside>

      <main className={styles.main}>
        <header className={styles.previewHeader}>
          <div>
            <strong>{previewCard?.title ?? '卡片预览'}</strong>
            <span>
              {workspace
                ? workspace.state === 'ready'
                  ? previewDevice
                    ? `本地开发 · Live · ${previewDevice.deviceId}`
                    : '本地开发 · Mock · 未绑定兼容设备'
                  : workspace.card
                    ? '本地开发 · 显示最后有效构建'
                    : '本地开发 · 等待检查通过'
                : previewDevice
                  ? `Live · ${previewDevice.deviceId}`
                  : previewCard && selectedDevice
                    ? `Mock · 卡片不支持 ${selectedDevice.deviceTypeId}`
                    : 'Mock · 未绑定设备'}
            </span>
          </div>
          <span className={styles.profile}>
            {workspace
              ? workspaceCard?.authoringProfile ?? '等待检查'
              : selectedCard?.authoringProfile ?? '等待安装'}
          </span>
        </header>
        <div ref={previewRef} className={styles.preview}>
          {!previewCard ? (
            <div className={styles.empty}>
              {workspace
                ? '修复 diagnostics.json 错误后自动预览。'
                : '打开卡片源码目录并检查通过后，可在这里预览。'}
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

function workspaceSummary(workspace: DeviceCardWorkspaceStatus): string {
  const errors = workspace.diagnostics.filter(
    (diagnostic) => diagnostic.severity === 'error'
  ).length
  const warnings = workspace.diagnostics.length - errors
  if (workspace.state === 'building') {
    return workspace.card
      ? '正在检查新快照，预览暂时保留上一个成功版本。'
      : '正在创建受限源码快照并调用 Electron 内置 Builder。'
  }
  if (workspace.state === 'ready') {
    return warnings > 0
      ? `构建成功，仍有 ${warnings} 条警告。`
      : '构建成功，可以安装当前源码。'
  }
  return `${errors} 个错误；安装已禁用。`
}

async function submitAction(
  request: DeviceCardHostActionRequest,
  laboratory: ReturnType<typeof useServices>['laboratory'],
  resolveAction: (run: DeviceCardActionRun) => Promise<void>
): Promise<void> {
  try {
    const job = await laboratory.addJob({
      deviceId: request.deviceId,
      action: request.action,
      actionArgs: request.params
    })
    // addJob 只表示 run 已受理；卡片读数靠 Edge device_status WS。
    const finished = await waitForJob(laboratory, job.jobId)
    await resolveAction({
      requestId: request.requestId,
      action: request.action,
      status: mapActionStatus(finished.status),
      result: {
        jobId: finished.jobId,
        status: finished.status,
        ...extractNodeResult(finished.result)
      },
      error: finished.status === 'failed'
        ? '设备动作执行失败。'
        : undefined
    })
  } catch (error) {
    await resolveAction({
      requestId: request.requestId,
      action: request.action,
      status: 'ERROR',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

async function waitForJob(
  laboratory: ReturnType<typeof useServices>['laboratory'],
  jobId: string,
  timeoutMs = 120_000
): Promise<Awaited<ReturnType<typeof laboratory.getJobStatus>>> {
  const started = Date.now()
  let status = 'pending'
  while (Date.now() - started < timeoutMs) {
    const current = await laboratory.getJobStatus(jobId)
    status = current.status
    if (
      status === 'completed' ||
      status === 'failed' ||
      status === 'cancelled' ||
      status === 'cancel_requested' ||
      status === 'dispatch_unknown'
    ) {
      return {
        ...current,
        jobId: current.jobId || jobId
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`等待动作完成超时（${timeoutMs}ms），最后状态：${status}`)
}

function extractNodeResult(
  result: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const nodes = result.nodes
  if (!Array.isArray(nodes) || nodes.length === 0) return {}
  const node = nodes[0]
  if (!node || typeof node !== 'object' || Array.isArray(node)) return {}
  const nodeResult = (node as Record<string, unknown>).result
  if (!nodeResult || typeof nodeResult !== 'object' || Array.isArray(nodeResult)) {
    return {}
  }
  return nodeResult as Record<string, unknown>
}

function mapActionStatus(
  status: string
): DeviceCardActionRun['status'] {
  if (status === 'completed') return 'DONE'
  if (status === 'failed' || status === 'dispatch_unknown') return 'ERROR'
  if (status === 'cancelled' || status === 'cancel_requested') return 'CANCELLED'
  if (status === 'running') return 'RUNNING'
  return 'ACCEPTED'
}

