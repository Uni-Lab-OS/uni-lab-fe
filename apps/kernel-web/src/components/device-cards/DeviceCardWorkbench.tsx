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
  DeviceCardAuthoringContext,
  DeviceCardAuthoringProfile,
  DeviceCardHostActionRequest,
  DeviceCardRuntimeSnapshot,
  InstalledDeviceCard
} from '@unilab/device-card-sdk'

import { useDeviceStatus } from '../../hooks/useDeviceStatus'
import styles from './DeviceCardWorkbench.module.scss'

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
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!desktopApi) return
    setLoading(true)
    setMessage(null)
    try {
      const [installed, catalog] = await Promise.all([
        desktopApi.list(),
        services.laboratory.getDeviceCatalog().catch(() => [])
      ])
      setCards(installed)
      setDevices(catalog)
      setSelectedCardKey((current) =>
        installed.some((card) => card.key === current)
          ? current
          : installed[0]?.key ?? ''
      )
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '加载设备卡片失败')
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

  const selectedCard = cards.find((card) => card.key === selectedCardKey)
  const selectedDevice = devices.find(
    (device) => device.deviceId === selectedDeviceId
  ) ?? devices[0]
  const previewDevice = selectedDevice && selectedCard?.deviceTypes.includes(
    selectedDevice.deviceTypeId
  )
    ? selectedDevice
    : undefined

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
    return {
      ...live,
      status: selectedDevice.online ? 'online' : 'offline',
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
    () => previewDevice
      ? runtimeState
      : { status: 'idle', online: false },
    [previewDevice, runtimeState]
  )
  runtimeStateRef.current = previewState

  useEffect(() => {
    if (!desktopApi || !selectedCard || !previewRef.current) return
    const preview = previewRef.current
    let disposed = false
    const context: DeviceCardRuntimeSnapshot = {
      mode: previewDevice ? 'live' : 'mock',
      device: {
        deviceId: previewDevice?.deviceId ?? null,
        deviceTypeId:
          previewDevice?.deviceTypeId ?? selectedCard.deviceTypes[0] ?? '',
        title: previewDevice?.label ?? selectedCard.title
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
      void desktopApi.open({
        key: selectedCard.key,
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
      }).catch((error) => {
        if (!disposed) {
          setMessage(error instanceof Error ? error.message : '打开卡片失败')
        }
      })
    })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      void desktopApi.close()
    }
  }, [desktopApi, previewDevice, selectedCard])

  useEffect(() => {
    if (!desktopApi || !selectedCard) return
    void desktopApi.updateState(previewState)
  }, [desktopApi, previewState, selectedCard])

  useEffect(() => {
    if (!desktopApi) return
    return desktopApi.onActionRequest((request) => {
      void submitAction(request, services.laboratory, desktopApi.resolveAction)
    })
  }, [desktopApi, services.laboratory])

  const importCard = async (): Promise<void> => {
    if (!desktopApi) return
    setMessage(null)
    try {
      const imported = await desktopApi.importCard()
      if (!imported) return
      await refresh()
      setSelectedCardKey(imported.key)
      setMessage(`已导入并由 Electron 重新构建：${imported.title}`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入卡片失败')
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
        setMessage(`完整 Authoring Kit 已保存：${saved.path}`)
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : '导出 Authoring Kit 失败'
      )
    } finally {
      setExportingKit(false)
    }
  }

  if (!desktopApi) {
    return (
      <section className={styles.unavailable}>
        <h1>设备自定义卡片</h1>
        <p>卡片导入和隔离预览仅在 Electron 桌面端可用。</p>
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
          <button type="button" onClick={() => void importCard()}>
            导入 .ulcard
          </button>
        </header>

        <label>
          卡片
          <select
            value={selectedCardKey}
            onChange={(event) => setSelectedCardKey(event.target.value)}
            disabled={loading || cards.length === 0}
          >
            {cards.length === 0 ? <option value="">尚未导入</option> : null}
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
                {device.label} · {device.online ? '在线' : '离线'}
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
          {exportingKit ? '正在生成…' : '导出完整 Authoring Kit'}
        </button>

        <div className={styles.security}>
          <strong>隔离策略</strong>
          <span>WebContentsView · sandbox · contextIsolation</span>
          <span>网络禁用 · Node 禁用 · Action 白名单</span>
        </div>
        {message ? <p className={styles.message}>{message}</p> : null}
      </aside>

      <main className={styles.main}>
        <header className={styles.previewHeader}>
          <div>
            <strong>{selectedCard?.title ?? '卡片预览'}</strong>
            <span>
              {previewDevice
                ? `Live · ${previewDevice.deviceId}`
                : selectedCard && selectedDevice
                  ? `Mock · 卡片不支持 ${selectedDevice.deviceTypeId}`
                  : 'Mock · 未绑定设备'}
            </span>
          </div>
          <span className={styles.profile}>
            {selectedCard?.authoringProfile ?? '等待导入'}
          </span>
        </header>
        <div ref={previewRef} className={styles.preview}>
          {!selectedCard ? (
            <div className={styles.empty}>
              导入本地 Agent 生成的 .ulcard 后在这里预览。
            </div>
          ) : null}
        </div>
      </main>
    </section>
  )
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
    await resolveAction({
      requestId: request.requestId,
      action: request.action,
      status: mapActionStatus(job.status),
      result: { jobId: job.jobId, status: job.status }
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

function mapActionStatus(
  status: string
): DeviceCardActionRun['status'] {
  if (status === 'completed') return 'DONE'
  if (status === 'failed' || status === 'dispatch_unknown') return 'ERROR'
  if (status === 'cancelled' || status === 'cancel_requested') return 'CANCELLED'
  if (status === 'running') return 'RUNNING'
  return 'ACCEPTED'
}

function jsonType(value: unknown): string {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value === 'object' ? 'object' : typeof value
}

function createAuthoringContext(
  device: DeviceCatalogItem,
  state: Record<string, unknown>
): DeviceCardAuthoringContext {
  return {
    schemaVersion: 'device-card-authoring-context/v1',
    deviceTypeId: device.deviceTypeId,
    deviceId: device.deviceId,
    title: device.label,
    actions: device.actions.map((action) => ({
      action: action.actionName,
      label: action.label,
      inputSchema: action.inputSchema,
      outputSchema: action.outputSchema,
      busy: action.isBusy
    })),
    stateSchema: Object.fromEntries(
      Object.entries(state).map(([key, value]) => [
        key,
        {
          type: jsonType(value),
          status: 'unresolved',
          source: 'runtime-sample'
        }
      ])
    ),
    sampleState: state,
    media: []
  }
}
