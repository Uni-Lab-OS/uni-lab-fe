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
import type {
  DeviceCardActionRun,
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
  const [loading, setLoading] = useState(false)
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
  const compatibleDevices = useMemo(() => {
    if (!selectedCard) return []
    return devices.filter((device) =>
      selectedCard.deviceTypes.includes(device.deviceTypeId)
    )
  }, [devices, selectedCard])
  const selectedDevice = compatibleDevices.find(
    (device) => device.deviceId === selectedDeviceId
  ) ?? compatibleDevices[0]

  useEffect(() => {
    setSelectedDeviceId((current) =>
      compatibleDevices.some((device) => device.deviceId === current)
        ? current
        : compatibleDevices[0]?.deviceId ?? ''
    )
  }, [compatibleDevices])

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
  runtimeStateRef.current = runtimeState

  useEffect(() => {
    if (!desktopApi || !selectedCard || !previewRef.current) return
    const preview = previewRef.current
    let disposed = false
    const context: DeviceCardRuntimeSnapshot = {
      mode: selectedDevice ? 'live' : 'mock',
      device: {
        deviceId: selectedDevice?.deviceId ?? null,
        deviceTypeId:
          selectedDevice?.deviceTypeId ?? selectedCard.deviceTypes[0] ?? '',
        title: selectedDevice?.label ?? selectedCard.title
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
        availableActions: selectedDevice?.actions.map(
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
  }, [desktopApi, selectedCard, selectedDevice])

  useEffect(() => {
    if (!desktopApi || !selectedCard) return
    void desktopApi.updateState(runtimeState)
  }, [desktopApi, runtimeState, selectedCard])

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

  const exportContext = async (): Promise<void> => {
    if (!fileApi || !selectedDevice) return
    const stateSchema = Object.fromEntries(
      Object.entries(runtimeState).map(([key, value]) => [
        key,
        {
          type: jsonType(value),
          status: 'unresolved',
          source: 'runtime-sample'
        }
      ])
    )
    await fileApi.save({
      path: null,
      defaultName: `${selectedDevice.deviceTypeId}-authoring-context.json`,
      content: `${JSON.stringify({
        schemaVersion: 'device-card-authoring-context/v1',
        deviceTypeId: selectedDevice.deviceTypeId,
        deviceId: selectedDevice.deviceId,
        title: selectedDevice.label,
        actions: selectedDevice.actions.map((action) => ({
          action: action.actionName,
          label: action.label,
          inputSchema: action.inputSchema,
          outputSchema: action.outputSchema,
          busy: action.isBusy
        })),
        stateSchema,
        sampleState: runtimeState,
        media: []
      }, null, 2)}\n`
    })
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
            disabled={compatibleDevices.length === 0}
          >
            {compatibleDevices.length === 0 ? (
              <option value="">Mock 模式</option>
            ) : null}
            {compatibleDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label} · {device.online ? '在线' : '离线'}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={styles.secondary}
          disabled={!selectedDevice || !fileApi}
          onClick={() => void exportContext()}
        >
          导出 Authoring Context
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
              {selectedDevice
                ? `Live · ${selectedDevice.deviceId}`
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
