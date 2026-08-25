/** OS source-map 的最小宿主无关合同。 */
export interface WorkflowSourceMapEntry {
  workflow_node_uuid: string
  start_line: number
  start_column: number
  end_line: number
  end_column: number
}

/** Monaco、VS Code 与 OS 都使用的一基、UTF-16 源码位置。 */
export interface WorkflowSourcePosition {
  line: number
  column: number
}

export interface WorkflowSourceLocation extends WorkflowSourcePosition {
  workflowUuid: string
  workflowNodeUuid: string
  sourceUri: string
  endLine: number
  endColumn: number
}

export interface PackageSourceLocation {
  sourceUri: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export type WorkflowIdeDiagnosticSeverity =
  | 'error'
  | 'warning'
  | 'information'
  | 'hint'

/** Problems/Markers shared by the Theia and VS Code adapters. */
export interface WorkflowIdeDiagnostic extends PackageSourceLocation {
  severity: WorkflowIdeDiagnosticSeverity
  code: string
  message: string
  source?: string
  workflowUuid?: string
  workflowNodeUuid?: string
}

export interface WorkflowSourceProjection {
  workflowUuid: string
  sourceUri: string
  /** OS 已观测源码代；mappingAvailable 时也与 sourceMap 属于同一结果。 */
  sourceVersion: string
  /** false 表示只绑定了已保存文件，仍在等待 OS 签发 source map。 */
  mappingAvailable: boolean
  sourceMap: readonly WorkflowSourceMapEntry[]
}

/** The complete source saved by an IDE, signed with its registered workflow identity. */
export interface WorkflowIdeSavedSource {
  workflowUuid: string
  sourceUri: string
  sourceVersion: string
  pythonSource: string
}

export interface WorkflowIdeSubscription {
  dispose(): void
}

/** Workflow React surface 与任意 IDE 宿主之间唯一需要实现的端口。 */
export interface WorkflowIdeBridge {
  /** 外部编辑器当前光标；宿主在文件 dirty 时应传 null。 */
  sourcePosition?: WorkflowSourcePosition | null
  /** Current exact package source identity, including non-Workflow files. */
  activeSourceUri?: string | null
  /** True only when the exact registered workflow source tab is dirty. */
  activeWorkflowSourceDirty?: boolean
  /** Ask the IDE host to save the exact active registered workflow source. */
  saveActiveWorkflowSource?: () => Promise<void>
  /** Receive complete sources after the IDE has durably saved them. */
  subscribeSavedWorkflowSource?: (
    listener: (source: WorkflowIdeSavedSource) => void
  ) => WorkflowIdeSubscription
  onRevealSourceLocation?: (location: WorkflowSourceLocation) => void
  onRevealPackageSource?: (location: PackageSourceLocation) => void
  onSourceProjectionChange?: (
    projection: WorkflowSourceProjection | null
  ) => void
  onDiagnosticsChange?: (
    diagnostics: readonly WorkflowIdeDiagnostic[]
  ) => void
}

/** Compatibility advertised by every packaged adapter. */
export const WORKFLOW_IDE_BRIDGE_COMPATIBILITY = Object.freeze({
  protocolVersion: 1,
  sourceMapContract: 'unilab.workflow-source-map/v1',
  packageSourceContract: 'unilab.package-source/v1',
  minimumOsContract: 'authoring-source-map/v1'
})

export interface WorkflowPackageSource {
  packageId: string
  relativePath: string
}

export interface WorkflowPackageMount {
  packageId: string
  packageRootUri: string
  editable: boolean
  readOnly: boolean
}

export interface WorkflowSavedSourceAggregate {
  workflow_revision: number
  draft: {
    python_source: string
    draft_hash: string
  } | null
  candidate: {
    draft_hash: string
    normalized_python_source: string
  } | null
}

export interface WorkflowSavedSourceRuntime<
  TAggregate extends WorkflowSavedSourceAggregate = WorkflowSavedSourceAggregate
> {
  getWorkflowAuthoring: (workflowUuid: string) => Promise<{
    workflow_revision: number
    draft: {
      python_source: string
      draft_hash: string
    } | null
  }>
  saveWorkflowAuthoringDraft: (
    workflowUuid: string,
    request: {
      python_source: string
      expected_draft_hash: string | null
      expected_workflow_revision: number
    }
  ) => Promise<TAggregate>
}

export type WorkflowSavedSourceSyncResult<
  TAggregate extends WorkflowSavedSourceAggregate = WorkflowSavedSourceAggregate
> =
  | { kind: 'compiled'; aggregate: TAggregate }
  | { kind: 'source-changed' }
  | { kind: 'source-unavailable' }

export type WorkflowIdeMappingStatus =
  | 'active'
  | 'paused: unsaved file'
  | 'paused: waiting for OS source map'

/** VS Code 与 Theia adapter 共用的编辑器同步状态。 */
export interface WorkflowIdeSyncState {
  currentUri: string | null
  dirty: boolean
  cursor: WorkflowSourcePosition | null
  sourcePosition: WorkflowSourcePosition | null
  sourceProjection: WorkflowSourceProjection | null
  resolvedSourceUri: string | null
  staleSourceVersion: string | null
}

export interface WorkflowIdeEditorSnapshot {
  currentUri: string | null
  dirty: boolean
  cursor: WorkflowSourcePosition | null
}

export interface WorkflowIdeResolvedLocation {
  sourceUri: string
  resolvedUri: string
  line: number
  column: number
  endLine: number
  endColumn: number
  readOnly: boolean
  workflowUuid?: string
  workflowNodeUuid?: string
}

export interface WorkflowIdeResolvedDiagnostic
  extends WorkflowIdeResolvedLocation {
  severity: WorkflowIdeDiagnosticSeverity
  code: string
  message: string
  source: string
}

/** The only host-specific surface required by either IDE adapter. */
export interface WorkflowIdeHostPort {
  revealSource: (location: WorkflowIdeResolvedLocation) => Promise<void>
  replaceDiagnostics: (
    diagnostics: readonly WorkflowIdeResolvedDiagnostic[]
  ) => void | Promise<void>
  saveActiveWorkflowSource?: () => Promise<void>
  reportError?: (message: string) => void
}

export interface WorkflowIdeHostAdapterSnapshot {
  sync: WorkflowIdeSyncState
  activeSourceUri: string | null
  packageMounts: readonly WorkflowPackageMount[]
  diagnostics: readonly WorkflowIdeResolvedDiagnostic[]
}

/**
 * Host-neutral adapter core. Native adapters translate editor/Problems APIs;
 * source identity, stale-map handling and exact ranges stay here.
 */
export class WorkflowIdeHostAdapter {
  readonly bridge: WorkflowIdeBridge

  private sync = createWorkflowIdeSyncState()
  private packageMounts: readonly WorkflowPackageMount[] = []
  private sourceDiagnostics: readonly WorkflowIdeDiagnostic[] = []
  private diagnostics: readonly WorkflowIdeResolvedDiagnostic[] = []
  private readonly savedSourceListeners = new Set<
    (source: WorkflowIdeSavedSource) => void
  >()

  constructor(
    private readonly host: WorkflowIdeHostPort,
    private readonly onSnapshotChange?: (
      snapshot: WorkflowIdeHostAdapterSnapshot
    ) => void
  ) {
    this.bridge = {
      sourcePosition: null,
      activeSourceUri: null,
      activeWorkflowSourceDirty: false,
      ...(host.saveActiveWorkflowSource
        ? { saveActiveWorkflowSource: () => host.saveActiveWorkflowSource!() }
        : {}),
      subscribeSavedWorkflowSource: listener => {
        this.savedSourceListeners.add(listener)
        return {
          dispose: () => { this.savedSourceListeners.delete(listener) }
        }
      },
      onRevealSourceLocation: location => {
        void this.revealSource(location).catch(error => this.report(error))
      },
      onRevealPackageSource: location => {
        void this.revealSource(location).catch(error => this.report(error))
      },
      onSourceProjectionChange: projection => {
        this.acceptSourceProjection(projection)
      },
      onDiagnosticsChange: diagnostics => {
        void this.acceptDiagnostics(diagnostics).catch(error => this.report(error))
      }
    }
  }

  get snapshot(): WorkflowIdeHostAdapterSnapshot {
    return {
      sync: this.sync,
      activeSourceUri: this.bridge.activeSourceUri ?? null,
      packageMounts: this.packageMounts,
      diagnostics: this.diagnostics
    }
  }

  setPackageMounts(mounts: readonly WorkflowPackageMount[]): void {
    this.packageMounts = [...mounts]
    const projection = this.sync.sourceProjection
    if (projection) this.acceptSourceProjection(projection)
    else this.publishSnapshot()
    if (this.sourceDiagnostics.length > 0) {
      void this.acceptDiagnostics(this.sourceDiagnostics).catch(
        error => this.report(error)
      )
    }
  }

  acceptSourceProjection(projection: WorkflowSourceProjection | null): void {
    const resolvedSourceUri = projection
      ? resolveIdeSourceUri(projection.sourceUri, this.packageMounts)?.resolvedUri ?? null
      : null
    this.sync = reduceWorkflowIdeSync(this.sync, {
      type: 'source-projection-changed',
      projection,
      resolvedSourceUri
    })
    this.refreshBridgeContext()
  }

  acceptEditor(snapshot: WorkflowIdeEditorSnapshot): void {
    this.sync = reduceWorkflowIdeSync(this.sync, {
      type: 'editor-changed',
      ...snapshot
    })
    this.refreshBridgeContext()
  }

  /** Publish a save only when the active tab still matches the OS registration. */
  acceptSavedWorkflowSource(pythonSource: string): boolean {
    if (
      !this.sync.currentUri ||
      this.sync.currentUri !== this.sync.resolvedSourceUri ||
      this.sync.dirty
    ) return false
    return this.acceptProjectedWorkflowSource(pythonSource)
  }

  /** Publish an exact projected file read, including initial map compilation. */
  acceptProjectedWorkflowSource(pythonSource: string): boolean {
    const projection = this.sync.sourceProjection
    if (
      !projection ||
      !this.sync.resolvedSourceUri ||
      (
        this.sync.currentUri === this.sync.resolvedSourceUri &&
        this.sync.dirty
      )
    ) return false
    const savedSource: WorkflowIdeSavedSource = {
      workflowUuid: projection.workflowUuid,
      sourceUri: projection.sourceUri,
      sourceVersion: projection.sourceVersion,
      pythonSource
    }
    for (const listener of this.savedSourceListeners) listener(savedSource)
    return true
  }

  async acceptDiagnostics(
    diagnostics: readonly WorkflowIdeDiagnostic[]
  ): Promise<void> {
    this.sourceDiagnostics = [...diagnostics]
    const resolved = diagnostics.flatMap(diagnostic => {
      const target = resolveIdeSourceUri(diagnostic.sourceUri, this.packageMounts)
      if (!target) return []
      return [{
        ...normalizedLocation(diagnostic, target),
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        source: diagnostic.source ?? 'UniLab'
      } satisfies WorkflowIdeResolvedDiagnostic]
    })
    this.diagnostics = resolved
    await this.host.replaceDiagnostics(resolved)
    this.publishSnapshot()
  }

  async dispose(): Promise<void> {
    this.savedSourceListeners.clear()
    this.sourceDiagnostics = []
    this.diagnostics = []
    await this.host.replaceDiagnostics([])
  }

  async revealSource(
    location: WorkflowSourceLocation | PackageSourceLocation
  ): Promise<void> {
    const target = resolveIdeSourceUri(location.sourceUri, this.packageMounts)
    if (!target) {
      throw new Error(`OS 未发布源码软件包挂载：${location.sourceUri}`)
    }
    await this.host.revealSource(normalizedLocation(location, target))
  }

  private refreshBridgeContext(): void {
    this.bridge.sourcePosition = this.sync.sourcePosition
    this.bridge.activeSourceUri = this.sync.currentUri
      ? packageSourceUriForResolvedUri(this.sync.currentUri, this.packageMounts)
      : null
    this.bridge.activeWorkflowSourceDirty = Boolean(
      this.sync.dirty &&
      this.sync.currentUri &&
      this.sync.currentUri === this.sync.resolvedSourceUri
    )
    this.publishSnapshot()
  }

  private publishSnapshot(): void {
    this.onSnapshotChange?.(this.snapshot)
  }

  private report(error: unknown): void {
    this.host.reportError?.(
      error instanceof Error ? error.message : String(error)
    )
  }
}

export type WorkflowIdeSyncEvent =
  | {
    type: 'source-projection-changed'
    projection: WorkflowSourceProjection | null
    resolvedSourceUri: string | null
  }
  | {
    type: 'editor-changed'
    currentUri: string | null
    dirty: boolean
    cursor: WorkflowSourcePosition | null
  }

export function createWorkflowIdeSyncState(): WorkflowIdeSyncState {
  return deriveSourcePosition({
    currentUri: null,
    dirty: false,
    cursor: null,
    sourcePosition: null,
    sourceProjection: null,
    resolvedSourceUri: null,
    staleSourceVersion: null
  })
}

/**
 * 纯状态机：dirty 后暂停反向映射，保存后继续等待 OS 发布不同 sourceVersion。
 * 宿主 adapter 只负责把自身事件和 URI 解析结果送入这里。
 */
export function reduceWorkflowIdeSync(
  state: WorkflowIdeSyncState,
  event: WorkflowIdeSyncEvent
): WorkflowIdeSyncState {
  if (event.type === 'source-projection-changed') {
    const staleSourceVersion = event.projection && state.staleSourceVersion &&
      event.projection.sourceVersion !== state.staleSourceVersion
      ? null
      : state.staleSourceVersion
    return deriveSourcePosition({
      ...state,
      sourceProjection: event.projection,
      resolvedSourceUri: event.resolvedSourceUri,
      staleSourceVersion: event.projection ? staleSourceVersion : null
    })
  }

  const projectedSource = Boolean(
    event.currentUri && event.currentUri === state.resolvedSourceUri
  )
  const staleSourceVersion = projectedSource && event.dirty &&
    state.staleSourceVersion === null
    ? state.sourceProjection?.sourceVersion ?? 'unmapped'
    : state.staleSourceVersion
  return deriveSourcePosition({
    ...state,
    currentUri: event.currentUri,
    dirty: event.dirty,
    cursor: event.cursor,
    staleSourceVersion
  })
}

export function workflowIdeMappingStatus(
  state: WorkflowIdeSyncState
): WorkflowIdeMappingStatus {
  if (state.dirty && state.currentUri === state.resolvedSourceUri) {
    return 'paused: unsaved file'
  }
  if (state.staleSourceVersion !== null) {
    return 'paused: waiting for OS source map'
  }
  if (state.sourceProjection?.mappingAvailable === false) {
    return 'paused: waiting for OS source map'
  }
  return 'active'
}

/** 只解释身份与相对路径；文件系统解析由 VS Code/Theia adapter 各自完成。 */
export function parseWorkflowPackageSource(
  sourceUri: string
): WorkflowPackageSource | null {
  const match = /^package:\/\/([^/]+)\/(.+)$/.exec(sourceUri)
  if (!match) return null
  const packageId = match[1] ?? ''
  const segments = (match[2] ?? '').split('/')
  if (
    !packageId ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) return null
  return { packageId, relativePath: segments.join('/') }
}

/** 只使用 OS 同代签发的精确挂载解析 package URI，不探测宿主候选路径。 */
export function resolveWorkflowPackageSourceUri(
  sourceUri: string,
  mounts: readonly WorkflowPackageMount[]
): string | null {
  const resolved = resolveWorkflowPackageSource(sourceUri, mounts)
  if (!resolved) return null
  try {
    const root = new URL(resolved.mount.packageRootUri.endsWith('/')
      ? resolved.mount.packageRootUri
      : `${resolved.mount.packageRootUri}/`)
    if (root.protocol !== 'file:') return null
    return new URL(resolved.source.relativePath, root).toString()
  } catch {
    return null
  }
}

/** Return the exact OS-signed mount together with the host-neutral package path. */
export function resolveWorkflowPackageSource(
  sourceUri: string,
  mounts: readonly WorkflowPackageMount[]
): { source: WorkflowPackageSource; mount: WorkflowPackageMount } | null {
  const source = parseWorkflowPackageSource(sourceUri)
  if (!source) return null
  const mount = mounts.find(candidate => candidate.packageId === source.packageId)
  return mount ? { source, mount } : null
}

export function resolveIdeSourceUri(
  sourceUri: string,
  mounts: readonly WorkflowPackageMount[]
): { resolvedUri: string; readOnly: boolean } | null {
  if (sourceUri.startsWith('file://')) {
    try {
      const uri = new URL(sourceUri)
      return uri.protocol === 'file:'
        ? { resolvedUri: uri.toString(), readOnly: false }
        : null
    } catch {
      return null
    }
  }
  const resolved = resolveWorkflowPackageSource(sourceUri, mounts)
  const resolvedUri = resolveWorkflowPackageSourceUri(sourceUri, mounts)
  if (!resolved || !resolvedUri) return null
  return { resolvedUri, readOnly: resolved.mount.readOnly }
}

/** Reverse one host file URI to the exact OS-signed package identity. */
export function packageSourceUriForResolvedUri(
  resolvedUri: string,
  mounts: readonly WorkflowPackageMount[]
): string | null {
  try {
    const target = new URL(resolvedUri)
    if (target.protocol !== 'file:') return null
    for (const mount of mounts) {
      const root = new URL(mount.packageRootUri.endsWith('/')
        ? mount.packageRootUri
        : `${mount.packageRootUri}/`)
      if (root.protocol !== 'file:' || !target.href.startsWith(root.href)) continue
      const relativePath = decodeURIComponent(target.href.slice(root.href.length))
      if (!relativePath || relativePath.split('/').some(segment =>
        !segment || segment === '.' || segment === '..'
      )) return null
      return `package://${mount.packageId}/${relativePath}`
    }
  } catch {
    return null
  }
  return null
}

/**
 * IDE 文件保存后，用 OS 刚观测到的哈希做一次同内容 CAS，以签发新候选和
 * source map。若保存后又有外部编辑发生，绝不覆盖更新内容。
 */
export async function synchronizeSavedWorkflowSource<
  TAggregate extends WorkflowSavedSourceAggregate
>(
  runtime: WorkflowSavedSourceRuntime<TAggregate>,
  workflowUuid: string,
  pythonSource: string
): Promise<WorkflowSavedSourceSyncResult<TAggregate>> {
  const current = await runtime.getWorkflowAuthoring(workflowUuid)
  if (!current.draft) return { kind: 'source-unavailable' }
  if (current.draft.python_source !== pythonSource) {
    return { kind: 'source-changed' }
  }
  const compiled = await runtime.saveWorkflowAuthoringDraft(workflowUuid, {
    python_source: pythonSource,
    expected_draft_hash: current.draft.draft_hash,
    expected_workflow_revision: current.workflow_revision
  })
  return { kind: 'compiled', aggregate: compiled }
}

/** 把画布节点身份解析为 OS 签发的精确源码范围。 */
export function workflowSourceLocationForNode(
  projection: WorkflowSourceProjection,
  workflowNodeUuid: string
): WorkflowSourceLocation | null {
  const entry = projection.sourceMap.find(
    (candidate) => candidate.workflow_node_uuid === workflowNodeUuid
  )
  if (!entry) return null
  return {
    workflowUuid: projection.workflowUuid,
    workflowNodeUuid,
    sourceUri: projection.sourceUri,
    line: entry.start_line,
    column: entry.start_column,
    endLine: entry.end_line,
    endColumn: entry.end_column
  }
}

/** 把外部 IDE 光标反查为最内层工作流节点。 */
export function workflowNodeAtSourcePosition(
  sourceMap: readonly WorkflowSourceMapEntry[],
  position: WorkflowSourcePosition
): string | null {
  const matches = sourceMap.filter((entry) =>
    comparePosition(position.line, position.column, entry.start_line,
      entry.start_column) >= 0 &&
    comparePosition(position.line, position.column, entry.end_line,
      entry.end_column) <= 0
  )
  if (matches.length === 0) return null
  matches.sort((left, right) => sourceSpan(left) - sourceSpan(right))
  return matches[0]?.workflow_node_uuid ?? null
}

function deriveSourcePosition(
  state: WorkflowIdeSyncState
): WorkflowIdeSyncState {
  const mapped = Boolean(
    state.currentUri && state.currentUri === state.resolvedSourceUri &&
    !state.dirty && state.staleSourceVersion === null &&
    state.sourceProjection?.mappingAvailable !== false
  )
  return {
    ...state,
    sourcePosition: mapped ? state.cursor : null
  }
}

function comparePosition(
  leftLine: number,
  leftColumn: number,
  rightLine: number,
  rightColumn: number
): number {
  return leftLine === rightLine
    ? leftColumn - rightColumn
    : leftLine - rightLine
}

function sourceSpan(entry: WorkflowSourceMapEntry): number {
  return (entry.end_line - entry.start_line) * 1_000_000 +
    entry.end_column - entry.start_column
}

function normalizedLocation(
  location: PackageSourceLocation & Partial<{
    workflowUuid: string
    workflowNodeUuid: string
  }>,
  target: { resolvedUri: string; readOnly: boolean }
): WorkflowIdeResolvedLocation {
  const line = Math.max(1, location.line ?? 1)
  const column = Math.max(1, location.column ?? 1)
  const endLine = Math.max(line, location.endLine ?? line)
  const endColumn = endLine === line
    ? Math.max(column, location.endColumn ?? column)
    : Math.max(1, location.endColumn ?? 1)
  return {
    sourceUri: location.sourceUri,
    resolvedUri: target.resolvedUri,
    line,
    column,
    endLine,
    endColumn,
    readOnly: target.readOnly,
    ...(location.workflowUuid ? { workflowUuid: location.workflowUuid } : {}),
    ...(location.workflowNodeUuid
      ? { workflowNodeUuid: location.workflowNodeUuid }
      : {})
  }
}
