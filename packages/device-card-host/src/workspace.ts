import { createHash } from 'node:crypto'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'

import {
  buildDeviceCard,
  packDeviceCard,
  unpackDeviceCard,
  type DeviceCardBuildMetadata
} from '@unilab/device-card-builder'
import type {
  DeviceCardAuthoringContext,
  DeviceCardDiagnostic,
  DeviceCardWorkspaceCard,
  DeviceCardWorkspaceState,
  DeviceCardWorkspaceStatus
} from '@unilab/device-card-sdk'

const WATCH_POLL_MS = 500
const IGNORED_ROOTS = new Set(['.git', '.unilab-card', 'node_modules'])

export interface DeviceCardWorkspaceArtifact {
  artifactDir: string
  sourceArchivePath: string
  metadata: DeviceCardBuildMetadata
}

export interface DeviceCardWorkspace {
  getStatus(): DeviceCardWorkspaceStatus
  getPreviewArtifact(): DeviceCardWorkspaceArtifact
  getReadyArtifact(): DeviceCardWorkspaceArtifact
  rebuild(): Promise<DeviceCardWorkspaceStatus>
  exportSourceArchive(
    archivePath: string
  ): Promise<DeviceCardWorkspaceArtifact>
  close(): Promise<void>
}

export async function createDeviceCardWorkspace(options: {
  projectDir: string
  workRoot: string
  authoringContext?: DeviceCardAuthoringContext
  watch?: boolean
  onStatus?: (status: DeviceCardWorkspaceStatus) => void
}): Promise<DeviceCardWorkspace> {
  const projectDir = await realpath(resolve(options.projectDir))
  if (!(await stat(projectDir)).isDirectory()) {
    throw new Error('本地卡片工作区必须是目录。')
  }
  const workRoot = resolve(options.workRoot)
  await mkdir(workRoot, { recursive: true })
  const sessionRoot = await mkdtemp(join(workRoot, '.workspace-'))
  const workspace = new LocalDeviceCardWorkspace({
    projectDir,
    sessionRoot,
    authoringContext: options.authoringContext,
    onStatus: options.onStatus
  })
  if (options.watch !== false) {
    await workspace.startWatching()
  }
  await workspace.rebuild()
  return workspace
}

class LocalDeviceCardWorkspace implements DeviceCardWorkspace {
  private readonly projectDir: string
  private readonly sessionRoot: string
  private readonly authoringContext?: DeviceCardAuthoringContext
  private readonly onStatus?: (status: DeviceCardWorkspaceStatus) => void
  private readonly diagnosticsPath: string
  private poller: ReturnType<typeof setInterval> | null = null
  private fingerprinting = false
  private lastFingerprint = ''
  private buildPromise: Promise<void> | null = null
  private rebuildPending = false
  private closed = false
  private revision = 0
  private artifact: DeviceCardWorkspaceArtifact | null = null
  private readonly successfulGenerationRoots: string[] = []
  private status: DeviceCardWorkspaceStatus

  constructor(options: {
    projectDir: string
    sessionRoot: string
    authoringContext?: DeviceCardAuthoringContext
    onStatus?: (status: DeviceCardWorkspaceStatus) => void
  }) {
    this.projectDir = options.projectDir
    this.sessionRoot = options.sessionRoot
    this.authoringContext = options.authoringContext
    this.onStatus = options.onStatus
    this.diagnosticsPath = join(
      this.projectDir,
      '.unilab-card',
      'diagnostics.json'
    )
    this.status = this.createStatus('building', [])
  }

  getStatus(): DeviceCardWorkspaceStatus {
    return structuredClone(this.status)
  }

  getPreviewArtifact(): DeviceCardWorkspaceArtifact {
    if (!this.artifact) {
      throw new Error('本地卡片工作区还没有可预览的成功构建。')
    }
    return cloneArtifact(this.artifact)
  }

  getReadyArtifact(): DeviceCardWorkspaceArtifact {
    if (this.status.state !== 'ready' || !this.artifact) {
      throw new Error('本地卡片源码尚未通过当前检查，不能安装或导出。')
    }
    return cloneArtifact(this.artifact)
  }

  async rebuild(): Promise<DeviceCardWorkspaceStatus> {
    if (this.closed) throw new Error('本地卡片工作区已关闭。')
    this.rebuildPending = true
    if (!this.buildPromise) {
      this.buildPromise = this.runBuildLoop().finally(() => {
        this.buildPromise = null
      })
    }
    await this.buildPromise
    return this.getStatus()
  }

  async exportSourceArchive(
    archivePath: string
  ): Promise<DeviceCardWorkspaceArtifact> {
    const artifact = this.getReadyArtifact()
    const destination = resolve(archivePath)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(artifact.sourceArchivePath, destination)
    return artifact
  }

  async startWatching(): Promise<void> {
    if (this.closed || this.poller) return
    try {
      this.lastFingerprint = await projectFingerprint(this.projectDir)
      this.poller = setInterval(() => {
        void this.checkForChanges()
      }, WATCH_POLL_MS)
    } catch (error) {
      await this.publish('error', [{
        severity: 'error',
        code: 'workspace.watch',
        message: error instanceof Error ? error.message : String(error)
      }])
    }
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    if (this.poller) clearInterval(this.poller)
    this.poller = null
    await this.buildPromise
    await rm(this.sessionRoot, { recursive: true, force: true })
  }

  private async checkForChanges(): Promise<void> {
    if (this.closed || this.fingerprinting) return
    this.fingerprinting = true
    try {
      const next = await projectFingerprint(this.projectDir)
      if (next !== this.lastFingerprint) {
        this.lastFingerprint = next
        await this.rebuild()
      }
    } catch (error) {
      await this.publish('error', [{
        severity: 'error',
        code: 'workspace.watch',
        message: error instanceof Error ? error.message : String(error)
      }])
    } finally {
      this.fingerprinting = false
    }
  }

  private async runBuildLoop(): Promise<void> {
    while (this.rebuildPending && !this.closed) {
      this.rebuildPending = false
      await this.buildOnce()
    }
  }

  private async buildOnce(): Promise<void> {
    await this.publish('building', [])
    const generationRoot = await mkdtemp(join(this.sessionRoot, 'build-'))
    const sourceArchivePath = join(generationRoot, 'source.ulcard')
    try {
      await packDeviceCard(this.projectDir, sourceArchivePath)
      const sourceDir = join(generationRoot, 'source')
      await unpackDeviceCard(sourceArchivePath, sourceDir)
      const artifactDir = join(generationRoot, 'artifact')
      const result = await buildDeviceCard({
        projectDir: sourceDir,
        outDir: artifactDir,
        authoringContext: this.authoringContext,
        development: true
      })
      if (!result.ok || !result.metadata) {
        await this.publish('error', result.diagnostics)
        await rm(generationRoot, { recursive: true, force: true })
        return
      }
      this.artifact = {
        artifactDir,
        sourceArchivePath,
        metadata: result.metadata
      }
      this.successfulGenerationRoots.push(generationRoot)
      await this.publish('ready', result.diagnostics)
      await this.pruneOldGenerations()
    } catch (error) {
      await this.publish('error', [workspaceDiagnostic(error)])
      await rm(generationRoot, { recursive: true, force: true })
    }
  }

  private async publish(
    state: DeviceCardWorkspaceState,
    diagnostics: DeviceCardDiagnostic[]
  ): Promise<void> {
    this.revision += 1
    let next = this.createStatus(state, diagnostics)
    try {
      await writeStatusFile(this.diagnosticsPath, next)
    } catch (error) {
      next = this.createStatus(state, [
        ...diagnostics,
        {
          severity: 'warning',
          code: 'workspace.diagnostics_write',
          message: error instanceof Error ? error.message : String(error),
          path: '.unilab-card/diagnostics.json'
        }
      ])
    }
    this.status = next
    try {
      this.onStatus?.(this.getStatus())
    } catch {
      // Renderer notification failure must not invalidate a successful build.
    }
  }

  private async pruneOldGenerations(): Promise<void> {
    while (this.successfulGenerationRoots.length > 2) {
      const obsolete = this.successfulGenerationRoots.shift()
      if (obsolete) {
        try {
          await rm(obsolete, { recursive: true, force: true })
        } catch {
          // Session cleanup removes any generation still in use or locked.
        }
      }
    }
  }

  private createStatus(
    state: DeviceCardWorkspaceState,
    diagnostics: DeviceCardDiagnostic[]
  ): DeviceCardWorkspaceStatus {
    return {
      schemaVersion: 'device-card-workspace-status/v1',
      projectDir: this.projectDir,
      projectName: basename(this.projectDir),
      state,
      revision: this.revision,
      updatedAt: new Date().toISOString(),
      diagnosticsPath: this.diagnosticsPath,
      diagnostics: diagnostics.map((diagnostic) => ({ ...diagnostic })),
      ...(this.artifact
        ? { card: workspaceCard(this.artifact.metadata) }
        : {})
    }
  }
}

function workspaceCard(
  metadata: DeviceCardBuildMetadata
): DeviceCardWorkspaceCard {
  return {
    id: metadata.cardId,
    version: metadata.cardVersion,
    title: metadata.manifest.title,
    deviceTypes: [...metadata.manifest.deviceTypes],
    authoringProfile: metadata.manifest.authoringProfile,
    sourceHash: metadata.sourceHash
  }
}

function cloneArtifact(
  artifact: DeviceCardWorkspaceArtifact
): DeviceCardWorkspaceArtifact {
  return {
    artifactDir: artifact.artifactDir,
    sourceArchivePath: artifact.sourceArchivePath,
    metadata: structuredClone(artifact.metadata)
  }
}

function workspaceDiagnostic(error: unknown): DeviceCardDiagnostic {
  return {
    severity: 'error',
    code: 'workspace.snapshot',
    message: error instanceof Error ? error.message : String(error)
  }
}

async function writeStatusFile(
  path: string,
  status: DeviceCardWorkspaceStatus
): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.tmp`
  await writeFile(temporary, `${JSON.stringify(status, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

async function projectFingerprint(
  root: string,
  directory = root
): Promise<string> {
  const entries: string[] = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (IGNORED_ROOTS.has(entry.name)) continue
    const absolute = resolve(directory, entry.name)
    const name = relative(root, absolute).replaceAll('\\', '/')
    if (entry.isSymbolicLink()) {
      entries.push(`link:${name}`)
    } else if (entry.isDirectory()) {
      entries.push(`dir:${name}`)
      entries.push(await projectFingerprint(root, absolute))
    } else if (entry.isFile()) {
      const info = await stat(absolute)
      entries.push(`file:${name}:${info.size}:${info.mtimeMs}`)
    }
  }
  return createHash('sha256')
    .update(entries.sort().join('\n'))
    .digest('hex')
}
