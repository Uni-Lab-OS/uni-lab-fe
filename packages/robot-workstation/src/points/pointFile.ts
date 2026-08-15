import type { PointConfigVersion, RobotPoint, WorkstationSite } from '../types'

export interface PointFileHandle {
  getFile: () => Promise<File>
  createWritable: () => Promise<PointFileWritable>
}

interface PointFileWritable {
  write: (content: string) => Promise<void>
  close: () => Promise<void>
}

interface PointFileHost {
  showOpenFilePicker?: (options: { types: PointFileType[]; multiple: false }) => Promise<PointFileHandle[]>
  showSaveFilePicker?: (options: { suggestedName: string; types: PointFileType[] }) => Promise<PointFileHandle>
}

interface PointFileType {
  description: string
  accept: Record<string, string[]>
}

export interface ParsedPointDocument {
  sites: WorkstationSite[]
  version?: string
  versionNote?: string
  savedAt?: string
  history: PointConfigVersion[]
}

const JSON_FILE_TYPES: PointFileType[] = [
  {
    description: '机械臂点位 JSON',
    accept: { 'application/json': ['.json'] },
  },
]

/** 深复制点位文件数据，避免修改只读夹具。 */
export function cloneSites(source: readonly WorkstationSite[]): WorkstationSite[] {
  return source.map((site) => ({
    ...site,
    points: site.points.map((point) => ({ ...point, pose: { ...point.pose } })),
  }))
}

/** 按库位编号、名称和物料类型筛选本地配置。 */
export function filterSites(sites: WorkstationSite[], query: string): WorkstationSite[] {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  if (!normalized) return sites
  return sites.filter((site) => `${site.id} ${site.label} ${site.materialLabel ?? ''}`.toLocaleLowerCase('zh-CN').includes(normalized))
}

/** 同时兼容旧 sites 结构和文档约定的 warehouses + points 结构。 */
export function parsePointFile(value: unknown): WorkstationSite[] {
  return parsePointDocument(value).sites
}

/** 解析点位数据及文件版本元数据，导入后从实际版本继续递增。 */
export function parsePointDocument(value: unknown): ParsedPointDocument {
  if (!isRecord(value)) throw new Error('点位文件不是有效对象')
  const metadata = parseMetadata(value)
  if (Array.isArray(value.sites)) {
    return { sites: validateSites(value.sites), ...metadata }
  }
  if (!Array.isArray(value.warehouses) || !Array.isArray(value.points)) {
    throw new Error('点位文件缺少 warehouses 或 points 数组')
  }
  const points = value.points.filter(isRecord)
  const sites = value.warehouses.filter(isRecord).map((warehouse) => ({
    id: String(warehouse.id ?? ''),
    label: String(warehouse.name ?? warehouse.label ?? ''),
    category: normalizeCategory(warehouse.category),
    materialLabel: typeof warehouse.materialLabel === 'string' ? warehouse.materialLabel : undefined,
    calibrated: Boolean(warehouse.calibrated),
    points: points.filter((point) => point.siteId === warehouse.id).map(parsePoint),
  }))
  return { sites: validateSites(sites), ...metadata }
}

/** 输出文档约定的工站、版本、库位与扁平点位结构。 */
export function serializePointFile(
  sites: WorkstationSite[],
  version: string,
  versionNote = '',
  history: readonly PointConfigVersion[] = [],
): string {
  const savedAt = new Date().toISOString()
  return JSON.stringify(
    {
      station: { id: 'ST01', name: '机械臂工站' },
      version,
      versionNote,
      savedAt,
      history: [{ version, note: versionNote, savedAt }, ...history.filter((item) => item.version !== version)],
      warehouses: sites.map(({ points: _points, ...site }) => ({
        ...site,
        name: site.label,
      })),
      points: sites.flatMap((site) =>
        site.points.map((point) => ({
          siteId: site.id,
          id: point.id,
          name: point.label,
          type: point.kind,
          motion: point.motion,
          pose: [point.pose.x, point.pose.y, point.pose.z, point.pose.rx, point.pose.ry, point.pose.rz],
          status: point.status,
        })),
      ),
    },
    null,
    2,
  )
}

/** 优先覆写导入文件；否则请求新文件句柄；不支持时回退下载。 */
export async function persistPointFile(
  sites: WorkstationSite[],
  version: string,
  versionNote: string,
  history: readonly PointConfigVersion[],
  importedHandle: PointFileHandle | null,
): Promise<{ mode: 'direct' | 'download'; hash: string }> {
  const json = serializePointFile(sites, version, versionNote, history)
  const hash = await shortHash(json)
  const host = globalThis as typeof globalThis & PointFileHost
  const handle = importedHandle ?? (await chooseSaveHandle(host))
  if (handle) {
    const writable = await handle.createWritable()
    await writable.write(json)
    await writable.close()
    return { mode: 'direct', hash }
  }
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'ST01_robot_points.json'
  anchor.click()
  URL.revokeObjectURL(url)
  return { mode: 'download', hash }
}

/** 浏览器支持时以可覆写文件句柄导入，否则由调用方使用普通文件控件。 */
export async function choosePointFile(): Promise<{
  file: File
  handle: PointFileHandle
} | null> {
  const picker = (globalThis as typeof globalThis & PointFileHost).showOpenFilePicker
  if (!picker) return null
  const [handle] = await picker({ types: JSON_FILE_TYPES, multiple: false })
  return handle ? { file: await handle.getFile(), handle } : null
}

/** 从最新版本号生成下一个小版本。 */
export function nextPointVersion(history: readonly PointConfigVersion[]): string {
  const [major = 1, minor = 0] = history[0]?.version.split('.').map(Number) ?? []
  return `${Number.isFinite(major) ? major : 1}.${Number.isFinite(minor) ? minor + 1 : 1}`
}

function validateSites(value: unknown[]): WorkstationSite[] {
  if (value.length === 0) throw new Error('点位文件没有可用库位')
  if (value.some((site) => !isRecord(site) || !Array.isArray(site.points))) {
    throw new Error('点位文件中的库位缺少 points 数组')
  }
  const sites = cloneSites(value as unknown as WorkstationSite[]).map((site) => ({
    ...site,
    category: normalizeCategory(site.category),
    points: site.points.map((point) => ({
      ...point,
      status: normalizeStatus(point.status),
    })),
  }))
  const siteIds = sites.map((site) => site.id)
  const pointIds = sites.flatMap((site) => site.points.map((point) => point.id))
  if (siteIds.some((id) => !id.trim()) || new Set(siteIds).size !== siteIds.length) {
    throw new Error('点位文件包含空白或重复库位 ID')
  }
  if (pointIds.some((id) => !id.trim()) || new Set(pointIds).size !== pointIds.length) {
    throw new Error('点位文件包含空白或重复点位 ID')
  }
  if (sites.some((site) => site.points.some((point) => Object.values(point.pose).some((value) => !Number.isFinite(value))))) {
    throw new Error('点位文件包含非法位姿数值')
  }
  return sites
}

function parseMetadata(value: Record<string, unknown>): Omit<ParsedPointDocument, 'sites'> {
  const version = typeof value.version === 'string' && value.version.trim() ? value.version.trim() : undefined
  const versionNote = typeof value.versionNote === 'string' ? value.versionNote : undefined
  const savedAt = typeof value.savedAt === 'string' ? value.savedAt : undefined
  const history = Array.isArray(value.history)
    ? value.history.filter(isRecord).flatMap((item) => {
        if (typeof item.version !== 'string' || typeof item.note !== 'string' || typeof item.savedAt !== 'string') return []
        return [
          {
            version: item.version,
            note: item.note,
            savedAt: item.savedAt,
            fileHash: typeof item.fileHash === 'string' ? item.fileHash : '文件内未记录',
          },
        ]
      })
    : []
  if (history.length === 0 && version) {
    history.push({ version, note: versionNote || '导入文件', savedAt: savedAt ?? '时间未知', fileHash: '导入文件未计算' })
  }
  return { version, versionNote, savedAt, history }
}

function parsePoint(value: Record<string, unknown>): RobotPoint {
  const pose = Array.isArray(value.pose) ? value.pose.map(Number) : []
  return {
    id: String(value.id ?? ''),
    label: String(value.name ?? value.label ?? value.id ?? ''),
    kind: normalizeKind(value.type ?? value.kind),
    motion: value.motion === 'LIN' ? 'LIN' : 'PTP',
    status: normalizeStatus(value.status),
    pose: {
      x: pose[0] ?? 0,
      y: pose[1] ?? 0,
      z: pose[2] ?? 0,
      rx: pose[3] ?? 0,
      ry: pose[4] ?? 0,
      rz: pose[5] ?? 0,
    },
  }
}

function normalizeCategory(value: unknown): WorkstationSite['category'] {
  return value === '原料库位' || value === '工装库位' ? value : '缓存库位'
}

function normalizeStatus(value: unknown): RobotPoint['status'] {
  return value === 'verified' || value === 'pending_verification' || value === 'disabled' ? value : 'uncalibrated'
}

function normalizeKind(value: unknown): RobotPoint['kind'] {
  return value === 'home' || value === 'approach' || value === 'interact' || value === 'retreat' ? value : 'custom'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

async function chooseSaveHandle(host: PointFileHost): Promise<PointFileHandle | null> {
  if (!host.showSaveFilePicker) return null
  return host.showSaveFilePicker({
    suggestedName: 'ST01_robot_points.json',
    types: JSON_FILE_TYPES,
  })
}

async function shortHash(content: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return `local:${content.length.toString(16)}`
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `sha256:${hex.slice(0, 8)}…${hex.slice(-4)}`
}
