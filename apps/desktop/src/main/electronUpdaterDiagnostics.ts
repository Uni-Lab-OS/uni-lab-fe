import type { AppUpdater } from 'electron-updater'

type ElectronUpdaterLogger = NonNullable<AppUpdater['logger']>
type UpdateDownloadMode = 'unknown' | 'differential' | 'full'

interface UpdateDownloadProgressSample {
  total: number
  transferred: number
}

export interface ElectronUpdaterDiagnostics {
  logger: ElectronUpdaterLogger
  available(version: string, packageBytes?: number): void
  started(): void
  progress(sample: UpdateDownloadProgressSample): void
  completed(version: string): void
}

interface DownloadState {
  version?: string
  packageBytes?: number
  mode: UpdateDownloadMode
  transferredBytes?: number
  plannedTransferBytes?: number
}

/**
 * 把 electron-updater 的下载判定写入现有桌面诊断日志。
 *
 * 只接收上游公开 logger 与事件数据；不读取更新缓存或签名产物。debug 故意省略，
 * 避免 DifferentialDownloader 把数万条块操作明细写入用户日志。
 */
export function createElectronUpdaterDiagnostics(
  write: (message: string) => void
): ElectronUpdaterDiagnostics {
  let state: DownloadState = emptyDownloadState()

  const record = (
    level: 'info' | 'warn' | 'error',
    message: unknown
  ): void => {
    const safeMessage = sanitizeUpdaterMessage(message)

    if (/Cannot download differentially, fallback to full download:/iu.test(
      safeMessage
    )) {
      state.mode = 'full'
      const detail = safeMessage.replace(
        /^.*Cannot download differentially, fallback to full download:\s*/iu,
        ''
      )
      write(
        'Workbench 更新下载模式: mode=full reason=differential_fallback' +
        (detail ? ` detail=${detail}` : '')
      )
      return
    }

    if (/Unable to locate previous update\.zip/iu.test(safeMessage)) {
      state.mode = 'full'
      write(
        'Workbench 更新下载模式: mode=full reason=missing_previous_cache'
      )
      return
    }

    if (/^Download block maps\b/iu.test(safeMessage)) {
      state.mode = 'differential'
      write('Workbench 更新差分下载: 开始读取新旧 blockmap')
      return
    }

    if (/^Full: .+To download:/iu.test(safeMessage)) {
      state.mode = 'differential'
      write(`Workbench 更新差分下载计划: ${safeMessage}`)
      return
    }

    if (/^Differential download:/iu.test(safeMessage)) {
      state.mode = 'differential'
      write('Workbench 更新下载模式: mode=differential')
      return
    }

    write(`electron-updater ${level}: ${safeMessage}`)
  }

  return {
    logger: {
      info: (message?: unknown) => record('info', message),
      warn: (message?: unknown) => record('warn', message),
      error: (message?: unknown) => record('error', message)
    },
    available(version, packageBytes) {
      state = {
        ...emptyDownloadState(),
        version: sanitizeVersion(version),
        packageBytes: normalizeByteCount(packageBytes)
      }
    },
    started() {
      state = {
        version: state.version,
        packageBytes: state.packageBytes,
        mode: 'unknown'
      }
      write(
        `Workbench 更新下载开始: version=${state.version ?? 'unknown'}` +
        ` packageBytes=${formatByteCount(state.packageBytes)}`
      )
    },
    progress(sample) {
      const transferredBytes = normalizeByteCount(sample.transferred)
      const plannedTransferBytes = normalizeByteCount(sample.total)
      if (transferredBytes !== undefined) {
        state.transferredBytes = Math.max(
          state.transferredBytes ?? 0,
          transferredBytes
        )
      }
      if (plannedTransferBytes !== undefined) {
        state.plannedTransferBytes = Math.max(
          state.plannedTransferBytes ?? 0,
          plannedTransferBytes
        )
      }
    },
    completed(version) {
      const completedVersion = sanitizeVersion(version)
      const mode = resolveCompletedMode(state)
      const savedBytes = resolveSavedBytes(
        state.packageBytes,
        state.transferredBytes
      )
      const savedPercent = state.packageBytes !== undefined
        && savedBytes !== undefined
        && state.packageBytes > 0
        ? ((savedBytes / state.packageBytes) * 100).toFixed(1)
        : 'unknown'
      write(
        `Workbench 更新下载完成: version=${completedVersion}` +
        ` mode=${mode}` +
        ` packageBytes=${formatByteCount(state.packageBytes)}` +
        ` transferredBytes=${formatByteCount(state.transferredBytes)}` +
        ` plannedTransferBytes=${formatByteCount(state.plannedTransferBytes)}` +
        ` savedBytes=${formatByteCount(savedBytes)}` +
        ` savedPercent=${savedPercent}`
      )
    }
  }
}

function emptyDownloadState(): DownloadState {
  return { mode: 'unknown' }
}

function resolveCompletedMode(state: DownloadState): UpdateDownloadMode {
  if (state.mode !== 'unknown') return state.mode
  if (state.packageBytes === undefined || state.plannedTransferBytes === undefined) {
    return 'unknown'
  }
  return state.plannedTransferBytes < state.packageBytes
    ? 'differential'
    : 'full'
}

function resolveSavedBytes(
  packageBytes: number | undefined,
  transferredBytes: number | undefined
): number | undefined {
  if (packageBytes === undefined || transferredBytes === undefined) {
    return undefined
  }
  return Math.max(0, packageBytes - transferredBytes)
}

function normalizeByteCount(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : undefined
}

function formatByteCount(value: number | undefined): string {
  return value === undefined ? 'unknown' : String(value)
}

function sanitizeVersion(value: string): string {
  return value.replace(/[^0-9A-Za-z.+_-]/gu, '').slice(0, 80) || 'unknown'
}

function sanitizeUpdaterMessage(message: unknown): string {
  const raw = message instanceof Error
    ? `${message.name}: ${message.message}`
    : typeof message === 'string'
      ? message
      : safeStringify(message)
  return raw
    .replace(/https?:\/\/[^\s"'<>]+/giu, (value) => {
      try {
        const url = new URL(value)
        return `${url.origin}${url.pathname}`
      } catch {
        return '[UPDATE_URL]'
      }
    })
    .replace(/\b(token|password|secret)=([^\s&]+)/giu, '$1=[REDACTED]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 1_000)
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}
