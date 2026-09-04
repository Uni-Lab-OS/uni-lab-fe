import { DeviceManagementPanel } from '@unilab/device-management'
import type { DevicePackageCardProject } from '@unilab/device-card-sdk'
import type {
  DeviceCatalogItem,
  Services
} from '@unilab/services'
import * as React from 'react'

import { WorkbenchDeviceCard } from './workbench-device-card'

export type WorkbenchDeviceMode = 'generic-actions' | 'custom-card'

interface DeviceCardDiscoveryApi {
  package: {
    discover(workspacePath: string): Promise<DevicePackageCardProject[]>
  }
}

interface WorkbenchDeviceSurfaceProps {
  services: Services
  backend: {
    id: string
    name: string
    apiUrl: string
  }
  backendEnabled: boolean
  connection: 'disconnected' | 'connecting' | 'connected' | 'error'
  workspacePath: string
  runtimeRevision: string
  sessionRevision: string
  active: boolean
}

const DISCOVERY_RETRY_MS = 2_000
const DISCOVERY_MAX_ATTEMPTS = 30

/**
 * 返回仪器设备详情的默认工作面。
 *
 * @param customCardAvailable 当前领域包是否提供与运行设备匹配的定制卡片。
 * @returns 有定制卡片时优先定制卡片，否则返回通用动作。
 */
export function preferredWorkbenchDeviceMode(
  customCardAvailable: boolean
): WorkbenchDeviceMode {
  return customCardAvailable ? 'custom-card' : 'generic-actions'
}

/**
 * 渲染仪器设备内可键盘操作的“通用动作 / 定制卡片”切换器。
 *
 * @param props 当前模式、定制卡片可用性及模式变更回调。
 * @returns 与仪器设备身份色一致的页签组。
 */
export function WorkbenchDeviceModeSwitcher({
  mode,
  customCardAvailable,
  onChange
}: {
  mode: WorkbenchDeviceMode
  customCardAvailable: boolean
  onChange: (mode: WorkbenchDeviceMode) => void
}): React.JSX.Element {
  /** 根据方向键和首尾键切换仪器设备工作面并恢复焦点。 */
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>
  ): void => {
    if (!customCardAvailable) return
    const next = event.key === 'ArrowLeft' || event.key === 'Home'
      ? 'generic-actions'
      : event.key === 'ArrowRight' || event.key === 'End'
        ? 'custom-card'
        : null
    if (!next) return
    event.preventDefault()
    onChange(next)
    requestAnimationFrame(() => {
      document.getElementById(`unilab-workbench-device-${next}-tab`)?.focus()
    })
  }

  return (
    <div
      className="unilab-workbench-device-switcher"
      role="tablist"
      aria-label="仪器设备调试视图"
    >
      <button
        id="unilab-workbench-device-generic-actions-tab"
        type="button"
        role="tab"
        aria-selected={mode === 'generic-actions'}
        aria-controls="unilab-workbench-device-generic-actions-panel"
        tabIndex={mode === 'generic-actions' ? 0 : -1}
        onKeyDown={handleKeyDown}
        onClick={() => onChange('generic-actions')}
      >
        通用动作
      </button>
      {customCardAvailable ? (
        <button
          id="unilab-workbench-device-custom-card-tab"
          type="button"
          role="tab"
          aria-selected={mode === 'custom-card'}
          aria-controls="unilab-workbench-device-custom-card-panel"
          tabIndex={mode === 'custom-card' ? 0 : -1}
          onKeyDown={handleKeyDown}
          onClick={() => onChange('custom-card')}
        >
          定制卡片
        </button>
      ) : null}
    </div>
  )
}

/**
 * 在“仪器设备”入口组合通用动作与领域包定制卡片。
 *
 * @param props 当前服务、运行连接、工作区身份和表面可见状态。
 * @returns 有匹配卡片时默认打开卡片、仍可切回通用动作的设备工作面。
 */
export function WorkbenchDeviceSurface({
  services,
  backend,
  backendEnabled,
  connection,
  workspacePath,
  runtimeRevision,
  sessionRevision,
  active
}: WorkbenchDeviceSurfaceProps): React.JSX.Element {
  const api = React.useMemo(deviceCardDiscoveryApi, [])
  const resolvedWorkspacePath = React.useMemo(
    () => resolveWorkbenchCardWorkspacePath(workspacePath),
    [workspacePath]
  )
  const [mode, setMode] = React.useState<WorkbenchDeviceMode>('generic-actions')
  const [cardProjects, setCardProjects] = React.useState<
    readonly DevicePackageCardProject[]
  >([])
  const [matchedDeviceId, setMatchedDeviceId] = React.useState<string | null>(null)
  const [discovering, setDiscovering] = React.useState(
    Boolean(api && resolvedWorkspacePath)
  )
  const [discoveryError, setDiscoveryError] = React.useState<string | null>(null)
  const [discoveryRevision, setDiscoveryRevision] = React.useState(0)

  React.useEffect(() => {
    let disposed = false
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null
    let attempt = 0

    if (!api) {
      setDiscovering(false)
      setCardProjects([])
      setMatchedDeviceId(null)
      setMode('generic-actions')
      setDiscoveryError('桌面设备卡片 Host 不可用')
      return
    }
    if (!resolvedWorkspacePath) {
      setDiscovering(false)
      setCardProjects([])
      setMatchedDeviceId(null)
      setMode('generic-actions')
      setDiscoveryError('工作区路径尚未就绪')
      return
    }
    setDiscovering(true)
    setDiscoveryError(null)

    /** 先发现领域包卡片；设备目录未就绪时仍预加载卡片界面。 */
    const discover = async (): Promise<void> => {
      try {
        const projects = await api.package.discover(resolvedWorkspacePath)
        if (disposed) return
        if (projects.length === 0) {
          throw new Error('当前领域包没有 frontend/cards 设备卡片')
        }
        setCardProjects(projects)
        setMode((current) => (
          current === 'generic-actions'
            ? preferredWorkbenchDeviceMode(true)
            : current
        ))

        let devices: DeviceCatalogItem[] = []
        try {
          devices = await services.laboratory.getDeviceCatalog()
        } catch {
          devices = []
        }
        if (disposed) return

        const match = matchWorkspaceDeviceCard(projects, devices)
        setMatchedDeviceId(match?.deviceId ?? null)
        if (match) {
          setDiscoveryError(null)
          return
        }

        setDiscoveryError(
          devices.length === 0
            ? '设备目录尚未就绪，卡片界面已预加载，等待 OS 会话…'
            : '设备目录中没有与领域包卡片匹配的设备'
        )
        if (attempt < DISCOVERY_MAX_ATTEMPTS) {
          attempt += 1
          retryTimer = globalThis.setTimeout(() => {
            if (!disposed) void discover()
          }, DISCOVERY_RETRY_MS)
        }
      } catch (error) {
        if (disposed) return
        setCardProjects([])
        setMatchedDeviceId(null)
        setMode('generic-actions')
        setDiscoveryError(
          error instanceof Error ? error.message : '定制卡片发现失败'
        )
        if (attempt < DISCOVERY_MAX_ATTEMPTS) {
          attempt += 1
          retryTimer = globalThis.setTimeout(() => {
            if (!disposed) void discover()
          }, DISCOVERY_RETRY_MS)
        }
      } finally {
        if (!disposed) setDiscovering(false)
      }
    }

    void discover()
    return () => {
      disposed = true
      if (retryTimer !== null) globalThis.clearTimeout(retryTimer)
    }
  }, [
    api,
    connection,
    discoveryRevision,
    resolvedWorkspacePath,
    runtimeRevision,
    sessionRevision,
    services.laboratory
  ])

  const customCardAvailable = cardProjects.length > 0
  const catalogPending = customCardAvailable && matchedDeviceId === null
  return (
    <div
      className="unilab-workbench-device-shell"
      data-custom-card={customCardAvailable ? 'available' : 'unavailable'}
      aria-busy={discovering}
    >
      <WorkbenchDeviceModeSwitcher
        mode={mode}
        customCardAvailable={customCardAvailable}
        onChange={setMode}
      />
      {discovering || discoveryError ? (
        <div
          className="unilab-workbench-device-discovery"
          role={discoveryError && !catalogPending ? 'alert' : 'status'}
        >
          <span>{discoveryError
            ? catalogPending
              ? discoveryError
              : `定制卡片发现失败，已显示通用动作：${discoveryError}`
            : '正在检测领域包定制卡片…'}</span>
          {discoveryError ? (
            <button
              type="button"
              onClick={() => setDiscoveryRevision((revision) => revision + 1)}
            >
              重试
            </button>
          ) : null}
        </div>
      ) : null}
      <section
        id="unilab-workbench-device-generic-actions-panel"
        className="unilab-workbench-device-shell__panel"
        role="tabpanel"
        aria-labelledby="unilab-workbench-device-generic-actions-tab"
        hidden={mode !== 'generic-actions'}
      >
        {mode === 'generic-actions' ? (
          <DeviceManagementPanel
            services={services}
            backend={backend}
            backendEnabled={backendEnabled}
            connection={connection}
            preferredDeviceId={matchedDeviceId ?? undefined}
          />
        ) : null}
      </section>
      <section
        id="unilab-workbench-device-custom-card-panel"
        className="unilab-workbench-device-shell__panel"
        role="tabpanel"
        aria-labelledby="unilab-workbench-device-custom-card-tab"
        hidden={mode !== 'custom-card'}
      >
        {active && mode === 'custom-card' && customCardAvailable ? (
          <WorkbenchDeviceCard
            services={services}
            workspacePath={resolvedWorkspacePath}
            runtimeRevision={runtimeRevision}
            deviceId={matchedDeviceId ?? undefined}
          />
        ) : null}
      </section>
    </div>
  )
}

/**
 * 选择领域包卡片支持且已出现在设备目录中的首个设备。
 *
 * @param projects 当前工作区发现的设备卡片项目。
 * @param devices 当前 Authority 提供的设备目录。
 * @returns 匹配设备身份；没有匹配项时返回 null。
 */
export function matchWorkspaceDeviceCard(
  projects: readonly DevicePackageCardProject[],
  devices: readonly DeviceCatalogItem[]
): { projectId: string; deviceId: string } | null {
  for (const project of projects) {
    const device = devices.find((candidate) =>
      project.deviceTypes.includes(candidate.deviceTypeId)
    )
    if (device) return { projectId: project.id, deviceId: device.deviceId }
  }
  return null
}

/** 返回桌面外壳公开的领域包设备卡片发现接口。 */
function deviceCardDiscoveryApi(): DeviceCardDiscoveryApi | null {
  if (typeof globalThis.window === 'undefined') return null
  return (globalThis.window as Window & {
    api?: { deviceCards?: DeviceCardDiscoveryApi }
  }).api?.deviceCards ?? null
}

/**
 * 解析定制卡片发现使用的工作区根目录。
 * @param workspacePath 会话身份提供的路径；缺失时回退到 Theia URL hash。
 */
export function resolveWorkbenchCardWorkspacePath(
  workspacePath: string
): string {
  const explicit = workspacePath.trim()
  if (explicit) return explicit
  const hash = globalThis.location?.hash?.replace(/^#/, '').trim()
  return hash ?? ''
}
