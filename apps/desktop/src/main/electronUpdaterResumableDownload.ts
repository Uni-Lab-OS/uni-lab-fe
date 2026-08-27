import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  link,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable, Transform, type TransformCallback } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

const RESUME_METADATA_SCHEMA_VERSION = 1
const STALE_CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000
const PROGRESS_INTERVAL_MS = 500

interface DownloadProgress {
  total: number
  delta: number
  transferred: number
  percent: number
  bytesPerSecond: number
}

interface CancellationTokenLike {
  readonly cancelled: boolean
  createPromise<T>(
    task: (
      resolve: (value: T | PromiseLike<T>) => void,
      reject: (reason: Error) => void,
      onCancel: (handler: () => void) => void
    ) => void
  ): Promise<T>
}

interface ResumableDownloadOptions {
  readonly headers?: Record<
    string,
    string | number | readonly string[] | null | undefined
  > | null
  readonly sha2?: string | null
  readonly sha512?: string | null
  readonly cancellationToken: CancellationTokenLike
  readonly onProgress?: (progress: DownloadProgress) => void
}

interface ElectronUpdaterHttpExecutor {
  download(
    url: URL,
    destination: string,
    options: ResumableDownloadOptions
  ): Promise<unknown>
}

interface ElectronUpdaterWithDownloadTransport {
  readonly netSession?: {
    fetch(input: string, init?: RequestInit): Promise<Response>
  }
  readonly httpExecutor?: ElectronUpdaterHttpExecutor
  readonly downloadedUpdateHelper?: {
    readonly cacheDir?: string
  }
}

interface ResumeMetadata {
  schemaVersion: typeof RESUME_METADATA_SCHEMA_VERSION
  source: string
  algorithm: 'sha256' | 'sha512'
  checksum: string
  totalBytes: number
  etag?: string
  lastModified?: string
  updatedAt: string
}

interface ArtifactPaths {
  entryDirectory: string
  partialFile: string
  metadataFile: string
}

interface ExpectedDigest {
  algorithm: ResumeMetadata['algorithm']
  checksum: string
  encoding: 'base64' | 'hex'
}

export interface ElectronUpdaterResumableDownloadController {
  pause(): boolean
  resume(): boolean
  dispose(): void
}

interface BindResumableDownloadOptions {
  cacheDirectory?: string
  log: (message: string) => void
}

/**
 * 为 electron-updater 的全量产物下载增加跨失败、跨进程的断点续传。
 *
 * 半包存放在 updater pending 目录之外，避免上游异常清理删除它。完整文件会先
 * 校验发布元数据中的摘要，再复制回上游目标路径；平台签名验证和安装仍由
 * electron-updater 完成。差分下载继续走上游 blockmap 实现。
 */
export function bindElectronUpdaterResumableDownload(
  updater: ElectronUpdaterWithDownloadTransport,
  options: BindResumableDownloadOptions
): ElectronUpdaterResumableDownloadController {
  const executor = updater.httpExecutor
  const fetch = updater.netSession?.fetch.bind(updater.netSession)
  if (!executor || !fetch || typeof executor.download !== 'function') {
    return unsupportedController
  }

  const originalDownload = executor.download
  const activeGates = new Set<PauseGate>()
  let paused = false
  let disposed = false

  const wrappedDownload: ElectronUpdaterHttpExecutor['download'] = async (
    url,
    destination,
    downloadOptions
  ) => {
    if (disposed) {
      return originalDownload.call(executor, url, destination, downloadOptions)
    }
    const digest = resolveExpectedDigest(downloadOptions)
    if (!digest) {
      options.log(
        'Workbench 更新断点续传不可用: 发布元数据缺少 SHA256/SHA512，回退原下载器'
      )
      return originalDownload.call(executor, url, destination, downloadOptions)
    }
    const updaterCacheDirectory = updater.downloadedUpdateHelper?.cacheDir
    const cacheDirectory = options.cacheDirectory
      ?? (updaterCacheDirectory
        ? join(updaterCacheDirectory, 'resumable')
        : undefined)
    if (!cacheDirectory) {
      options.log(
        'Workbench 更新断点续传不可用: updater 缓存目录尚未就绪，回退原下载器'
      )
      return originalDownload.call(executor, url, destination, downloadOptions)
    }

    return downloadOptions.cancellationToken.createPromise<unknown>((
      resolve,
      reject,
      onCancel
    ) => {
      const abortController = new AbortController()
      onCancel(() => abortController.abort())
      void downloadArtifact({
        url,
        destination,
        downloadOptions,
        digest,
        cacheDirectory,
        fetch,
        log: options.log,
        abortSignal: abortController.signal,
        createGate: () => {
          const gate = new PauseGate()
          activeGates.add(gate)
          gate.once('close', () => activeGates.delete(gate))
          if (paused) gate.pauseTransfer()
          return gate
        }
      }).then(resolve, reject)
    })
  }

  executor.download = wrappedDownload

  return {
    pause(): boolean {
      if (disposed) return false
      paused = true
      for (const gate of activeGates) gate.pauseTransfer()
      return true
    },
    resume(): boolean {
      if (disposed) return false
      paused = false
      for (const gate of activeGates) gate.resumeTransfer()
      return true
    },
    dispose(): void {
      if (disposed) return
      disposed = true
      paused = false
      for (const gate of activeGates) gate.resumeTransfer()
      activeGates.clear()
      if (executor.download === wrappedDownload) {
        executor.download = originalDownload
      }
    }
  }
}

interface DownloadArtifactOptions {
  url: URL
  destination: string
  downloadOptions: ResumableDownloadOptions
  digest: ExpectedDigest
  cacheDirectory: string
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  log: (message: string) => void
  abortSignal: AbortSignal
  createGate: () => PauseGate
}

async function downloadArtifact(options: DownloadArtifactOptions): Promise<string> {
  const source = safeSource(options.url)
  const paths = resolveArtifactPaths(
    options.cacheDirectory,
    source,
    options.digest
  )
  await mkdir(paths.entryDirectory, { recursive: true })
  void pruneStaleCache(options.cacheDirectory, paths.entryDirectory)

  let metadata = await readResumeMetadata(paths.metadataFile)
  let partialBytes = await fileSize(paths.partialFile)
  if (!metadataMatches(metadata, source, options.digest)
    || (metadata && partialBytes > metadata.totalBytes)) {
    await clearArtifact(paths)
    await mkdir(paths.entryDirectory, { recursive: true })
    metadata = null
    partialBytes = 0
  }

  try {
    if (metadata && partialBytes === metadata.totalBytes && partialBytes > 0) {
      await finishVerifiedArtifact(paths, options.destination, options.digest)
      emitProgress(
        options.downloadOptions,
        metadata.totalBytes,
        0,
        metadata.totalBytes,
        0,
        0
      )
      options.log(
        `Workbench 更新断点缓存已校验: bytes=${metadata.totalBytes}`
      )
      return options.destination
    }
    if (metadata && partialBytes > 0) {
      const response = await fetchUpdate(options, metadata, partialBytes)
      if (canAppendResponse(response, metadata, partialBytes)) {
        options.log(
          `Workbench 更新断点续传: offset=${partialBytes} total=${metadata.totalBytes}`
        )
        await streamResponseToPartial(
          response,
          paths.partialFile,
          partialBytes,
          metadata.totalBytes,
          options
        )
      } else if (response.status === 200) {
        options.log(
          'Workbench 更新断点续传: 服务端未接受 Range，已安全地从头下载'
        )
        metadata = await prepareFreshDownload(response, paths, source, options)
        await streamResponseToPartial(
          response,
          paths.partialFile,
          0,
          metadata.totalBytes,
          options
        )
      } else if (response.status === 206 || response.status === 416) {
        await cancelResponse(response)
        options.log(
          'Workbench 更新断点续传: Range 响应无效，已安全地从头下载'
        )
        const freshResponse = await fetchUpdate(options, null, 0)
        metadata = await prepareFreshDownload(
          freshResponse,
          paths,
          source,
          options
        )
        await streamResponseToPartial(
          freshResponse,
          paths.partialFile,
          0,
          metadata.totalBytes,
          options
        )
      } else {
        await cancelResponse(response)
        throw new Error(`更新断点请求失败: HTTP ${response.status}`)
      }
    } else {
      const response = await fetchUpdate(options, null, 0)
      metadata = await prepareFreshDownload(response, paths, source, options)
      await streamResponseToPartial(
        response,
        paths.partialFile,
        0,
        metadata.totalBytes,
        options
      )
    }

    const actualBytes = await fileSize(paths.partialFile)
    if (!metadata || actualBytes !== metadata.totalBytes) {
      throw new Error(
        `更新文件长度不完整: expected=${metadata?.totalBytes ?? 'unknown'} actual=${actualBytes}`
      )
    }
    await finishVerifiedArtifact(paths, options.destination, options.digest)
    options.log(`Workbench 更新断点下载完成: bytes=${actualBytes}`)
    return options.destination
  } catch (error) {
    const savedBytes = await fileSize(paths.partialFile)
    if (metadata) {
      emitProgress(
        options.downloadOptions,
        metadata.totalBytes,
        0,
        savedBytes,
        0,
        0
      )
    }
    options.log(`Workbench 更新断点下载已保留: bytes=${savedBytes}`)
    throw error
  }
}

async function prepareFreshDownload(
  response: Response,
  paths: ArtifactPaths,
  source: string,
  options: DownloadArtifactOptions
): Promise<ResumeMetadata> {
  if (response.status !== 200) {
    await cancelResponse(response)
    throw new Error(`更新下载请求失败: HTTP ${response.status}`)
  }
  const totalBytes = parsePositiveInteger(response.headers.get('content-length'))
  if (totalBytes === null) {
    await cancelResponse(response)
    throw new Error('更新服务没有返回有效的 Content-Length，无法安全断点续传')
  }
  const metadata: ResumeMetadata = {
    schemaVersion: RESUME_METADATA_SCHEMA_VERSION,
    source,
    algorithm: options.digest.algorithm,
    checksum: options.digest.checksum,
    totalBytes,
    ...readValidators(response),
    updatedAt: new Date().toISOString()
  }
  await writeFile(paths.partialFile, Buffer.alloc(0), { mode: 0o600 })
  await writeResumeMetadata(paths.metadataFile, metadata)
  return metadata
}

async function fetchUpdate(
  options: DownloadArtifactOptions,
  metadata: ResumeMetadata | null,
  partialBytes: number
): Promise<Response> {
  const headers = normalizeHeaders(options.downloadOptions.headers)
  if (metadata && partialBytes > 0) {
    headers.set('range', `bytes=${partialBytes}-`)
    const validator = strongValidator(metadata)
    if (validator) headers.set('if-range', validator)
  } else {
    headers.delete('range')
    headers.delete('if-range')
  }
  return options.fetch(options.url.href, {
    method: 'GET',
    headers,
    redirect: 'follow',
    signal: options.abortSignal
  })
}

function canAppendResponse(
  response: Response,
  metadata: ResumeMetadata,
  partialBytes: number
): boolean {
  if (response.status !== 206) return false
  const contentRange = parseContentRange(response.headers.get('content-range'))
  if (!contentRange
    || contentRange.start !== partialBytes
    || contentRange.total !== metadata.totalBytes
    || contentRange.end < contentRange.start
    || contentRange.end >= contentRange.total) {
    return false
  }
  const responseBytes = contentRange.end - contentRange.start + 1
  const contentLength = parsePositiveInteger(response.headers.get('content-length'))
  if (contentLength !== null && contentLength !== responseBytes) return false
  const responseEtag = response.headers.get('etag') ?? undefined
  if (metadata.etag && responseEtag && metadata.etag !== responseEtag) return false
  const responseModified = response.headers.get('last-modified') ?? undefined
  if (metadata.lastModified
    && responseModified
    && metadata.lastModified !== responseModified) {
    return false
  }
  return true
}

async function streamResponseToPartial(
  response: Response,
  partialFile: string,
  startingBytes: number,
  totalBytes: number,
  options: DownloadArtifactOptions
): Promise<void> {
  if (!response.body) throw new Error('更新下载响应没有可读取的正文')
  const source = Readable.fromWeb(
    response.body as unknown as NodeReadableStream<Uint8Array>
  )
  const gate = options.createGate()
  let transferred = startingBytes
  let pendingDelta = 0
  const startedAt = Date.now()
  let lastProgressAt = startedAt
  const progress = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      transferred += chunk.length
      pendingDelta += chunk.length
      const now = Date.now()
      if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
        emitProgress(
          options.downloadOptions,
          totalBytes,
          pendingDelta,
          transferred,
          now - startedAt,
          transferred - startingBytes
        )
        pendingDelta = 0
        lastProgressAt = now
      }
      callback(null, chunk)
    }
  })
  emitProgress(
    options.downloadOptions,
    totalBytes,
    0,
    transferred,
    0,
    0
  )
  await pipeline(
    source,
    gate,
    progress,
    createWriteStream(partialFile, { flags: 'a' })
  )
  emitProgress(
    options.downloadOptions,
    totalBytes,
    pendingDelta,
    transferred,
    Date.now() - startedAt,
    transferred - startingBytes
  )
}

function emitProgress(
  options: ResumableDownloadOptions,
  total: number,
  delta: number,
  transferred: number,
  elapsedMs: number,
  sessionTransferred: number
): void {
  const boundedTransferred = Math.min(total, Math.max(0, transferred))
  options.onProgress?.({
    total,
    delta: Math.max(0, delta),
    transferred: boundedTransferred,
    percent: total === 0 ? 0 : (boundedTransferred / total) * 100,
    bytesPerSecond: elapsedMs <= 0
      ? 0
      : Math.round((sessionTransferred * 1_000) / elapsedMs)
  })
}

async function finishVerifiedArtifact(
  paths: ArtifactPaths,
  destination: string,
  digest: ExpectedDigest
): Promise<void> {
  const actual = await hashFile(paths.partialFile, digest)
  if (actual !== digest.checksum) {
    await clearArtifact(paths)
    throw new Error(
      `更新文件 ${digest.algorithm.toUpperCase()} 校验失败，已丢弃损坏的断点缓存`
    )
  }
  await mkdir(dirname(destination), { recursive: true })
  await rm(destination, { force: true })
  try {
    await link(paths.partialFile, destination)
  } catch {
    await copyFile(paths.partialFile, destination)
  }
  await clearArtifact(paths)
}

async function hashFile(
  file: string,
  digest: ExpectedDigest
): Promise<string> {
  const hash = createHash(digest.algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest(digest.encoding)
}

function resolveExpectedDigest(
  options: ResumableDownloadOptions
): ExpectedDigest | null {
  if (options.sha512) {
    const encoding = isHexDigest(options.sha512, 128) ? 'hex' : 'base64'
    return {
      algorithm: 'sha512',
      checksum: encoding === 'hex' ? options.sha512.toLowerCase() : options.sha512,
      encoding
    }
  }
  if (options.sha2) {
    const encoding = isHexDigest(options.sha2, 64) ? 'hex' : 'base64'
    return {
      algorithm: 'sha256',
      checksum: encoding === 'hex' ? options.sha2.toLowerCase() : options.sha2,
      encoding
    }
  }
  return null
}

function isHexDigest(value: string, length: number): boolean {
  return value.length === length && /^[0-9a-f]+$/iu.test(value)
}

function resolveArtifactPaths(
  cacheDirectory: string,
  source: string,
  digest: ExpectedDigest
): ArtifactPaths {
  const key = createHash('sha256')
    .update(`${source}\n${digest.algorithm}\n${digest.checksum}`)
    .digest('hex')
  const entryDirectory = join(cacheDirectory, key)
  return {
    entryDirectory,
    partialFile: join(entryDirectory, 'artifact.part'),
    metadataFile: join(entryDirectory, 'state.json')
  }
}

async function readResumeMetadata(file: string): Promise<ResumeMetadata | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    return isResumeMetadata(value) ? value : null
  } catch {
    return null
  }
}

async function writeResumeMetadata(
  file: string,
  metadata: ResumeMetadata
): Promise<void> {
  const temporaryFile = `${file}.tmp`
  await writeFile(temporaryFile, JSON.stringify(metadata), {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(temporaryFile, file)
}

function isResumeMetadata(value: unknown): value is ResumeMetadata {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<ResumeMetadata>
  return candidate.schemaVersion === RESUME_METADATA_SCHEMA_VERSION
    && typeof candidate.source === 'string'
    && (candidate.algorithm === 'sha256' || candidate.algorithm === 'sha512')
    && typeof candidate.checksum === 'string'
    && typeof candidate.totalBytes === 'number'
    && Number.isSafeInteger(candidate.totalBytes)
    && candidate.totalBytes > 0
    && typeof candidate.updatedAt === 'string'
    && (candidate.etag === undefined || typeof candidate.etag === 'string')
    && (candidate.lastModified === undefined
      || typeof candidate.lastModified === 'string')
}

function metadataMatches(
  metadata: ResumeMetadata | null,
  source: string,
  digest: ExpectedDigest
): metadata is ResumeMetadata {
  return metadata !== null
    && metadata.source === source
    && metadata.algorithm === digest.algorithm
    && metadata.checksum === digest.checksum
}

function readValidators(response: Response): Pick<
  ResumeMetadata,
  'etag' | 'lastModified'
> {
  const etag = response.headers.get('etag') ?? undefined
  const lastModified = response.headers.get('last-modified') ?? undefined
  return {
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {})
  }
}

function strongValidator(metadata: ResumeMetadata): string | undefined {
  if (metadata.etag && !/^W\//iu.test(metadata.etag)) return metadata.etag
  return metadata.lastModified
}

function normalizeHeaders(
  input: ResumableDownloadOptions['headers']
): Headers {
  const headers = new Headers()
  for (const [name, value] of Object.entries(input ?? {})) {
    if (value === null || value === undefined) continue
    headers.set(name, Array.isArray(value) ? value.join(', ') : String(value))
  }
  return headers
}

function safeSource(url: URL): string {
  return `${url.origin}${url.pathname}`
}

function parsePositiveInteger(value: string | null): number | null {
  if (!value || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function parseContentRange(value: string | null): {
  start: number
  end: number
  total: number
} | null {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/iu.exec(value ?? '')
  if (!match) return null
  const start = Number(match[1])
  const end = Number(match[2])
  const total = Number(match[3])
  return [start, end, total].every(Number.isSafeInteger)
    ? { start, end, total }
    : null
}

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size
  } catch {
    return 0
  }
}

async function clearArtifact(paths: ArtifactPaths): Promise<void> {
  await rm(paths.entryDirectory, { recursive: true, force: true })
}

async function cancelResponse(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined)
}

async function pruneStaleCache(
  cacheDirectory: string,
  activeDirectory: string
): Promise<void> {
  try {
    const entries = await readdir(cacheDirectory, { withFileTypes: true })
    const now = Date.now()
    await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const directory = join(cacheDirectory, entry.name)
        if (directory === activeDirectory) return
        const age = now - (await stat(directory)).mtimeMs
        if (age > STALE_CACHE_MAX_AGE_MS) {
          await rm(directory, { recursive: true, force: true })
        }
      }))
  } catch {
    // 缓存清理失败不能阻断当前更新。
  }
}

class PauseGate extends Transform {
  private transferPaused = false
  private pending: (() => void) | null = null

  pauseTransfer(): void {
    this.transferPaused = true
  }

  resumeTransfer(): void {
    this.transferPaused = false
    const pending = this.pending
    this.pending = null
    pending?.()
  }

  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: TransformCallback
  ): void {
    const forward = (): void => callback(null, chunk)
    if (this.transferPaused) {
      this.pending = forward
    } else {
      forward()
    }
  }

  override _destroy(
    error: Error | null,
    callback: (error?: Error | null) => void
  ): void {
    this.resumeTransfer()
    callback(error)
  }
}

const unsupportedController: ElectronUpdaterResumableDownloadController = {
  pause: () => false,
  resume: () => false,
  dispose: () => undefined
}
