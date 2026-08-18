import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { startRemoteWorkbenchFacade } from './remote-facade.mjs'

/**
 * Owns one optional authenticated browser entrance for an already-running
 * Workbench backend. Desktop and service launchers share this state machine so
 * enabling remote access never creates another Theia or OS session.
 */
export function createRemoteWorkbenchController({
  backendPort,
  workspacePath,
  rendererUrl,
  configuration,
  log,
  startFacade = startRemoteWorkbenchFacade
}) {
  if (
    configuration.accessUrlFile
    && pathInside(workspacePath, configuration.accessUrlFile)
  ) {
    throw new Error('Remote access URL file must be outside the Workspace')
  }
  const renderer = new URL(rendererUrl)
  let phase = 'idle'
  let facade = null
  let accessUrl = null
  let failure = null
  let operation = Promise.resolve()

  const controller = Object.freeze({
    getSnapshot,
    start: () => exclusively(start),
    stop: () => exclusively(stop),
    close: () => exclusively(stop)
  })
  return controller

  function getSnapshot() {
    return Object.freeze({
      phase,
      origin: facade?.origin ?? null,
      accessUrl: phase === 'ready' ? accessUrl : null,
      pid: facade?.identity.pid ?? null,
      generation: facade?.identity.generation ?? null,
      expiresAt: facade?.identity.expiresAt ?? null,
      error: failure
    })
  }

  function exclusively(task) {
    const next = operation.then(task, task)
    operation = next.then(() => undefined, () => undefined)
    return next
  }

  async function start() {
    if (phase === 'ready') return getSnapshot()
    phase = 'starting'
    failure = null
    try {
      facade = await startFacade({
        backendPort,
        workspacePath,
        host: configuration.host,
        port: configuration.port,
        publicOrigin: configuration.publicOrigin,
        tlsCertificatePath: configuration.tlsCertificatePath,
        tlsKeyPath: configuration.tlsKeyPath,
        authenticationRequired: configuration.authenticationRequired,
        tokenTtlMs: configuration.tokenTtlMs,
        rendererPath: `${renderer.pathname}${renderer.search}${renderer.hash}`,
        log
      })
      accessUrl = facade.accessUrl
      if (configuration.accessUrlFile) {
        await writeSecretFile(configuration.accessUrlFile, accessUrl)
      }
      phase = 'ready'
      return getSnapshot()
    } catch (error) {
      await facade?.close().catch(() => undefined)
      facade = null
      accessUrl = null
      phase = 'failed'
      failure = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async function stop() {
    if (phase === 'idle') return getSnapshot()
    phase = 'stopping'
    const runningFacade = facade
    const deliveredAccessUrl = accessUrl
    facade = null
    accessUrl = null
    try {
      await runningFacade?.close()
      if (configuration.accessUrlFile && deliveredAccessUrl) {
        await removeMatchingSecretFile(
          configuration.accessUrlFile,
          deliveredAccessUrl
        )
      }
      phase = 'idle'
      failure = null
      return getSnapshot()
    } catch (error) {
      phase = 'failed'
      failure = error instanceof Error ? error.message : String(error)
      throw error
    }
  }
}

function pathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === ''
    || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function writeSecretFile(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, `${value}\n`, { mode: 0o600, flag: 'wx' })
    try {
      await rename(temporaryPath, filePath)
    } catch (error) {
      // POSIX rename replaces a stale delivery atomically. Windows rejects an
      // existing destination, so revoke that stale URL before installing the
      // new generation. The facade is already live and the new value remains
      // protected in its 0600 temporary file throughout the fallback.
      if (!isWindowsReplaceError(error)) throw error
      await rm(filePath, { force: true })
      await rename(temporaryPath, filePath)
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function removeMatchingSecretFile(filePath, expected) {
  try {
    const current = await readFile(filePath, 'utf8')
    if (current.trim() === expected) await rm(filePath, { force: true })
  } catch {
    // The authenticated facade is already stopped; delivery cleanup is best effort.
  }
}

function isWindowsReplaceError(error) {
  return process.platform === 'win32'
    && error
    && typeof error === 'object'
    && 'code' in error
    && (error.code === 'EEXIST' || error.code === 'EPERM')
}
