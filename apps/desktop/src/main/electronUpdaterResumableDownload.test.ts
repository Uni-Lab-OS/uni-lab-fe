import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { bindElectronUpdaterResumableDownload } from './electronUpdaterResumableDownload'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )))
})

describe('bindElectronUpdaterResumableDownload', () => {
  it('preserves an interrupted artifact and resumes the next attempt with Range', async () => {
    const root = await createTemporaryDirectory()
    const updaterCacheDirectory = join(root, 'updater-cache')
    const cacheDirectory = join(updaterCacheDirectory, 'resumable')
    const destination = join(root, 'pending-update.zip')
    const artifact = Buffer.alloc(256 * 1_024)
    for (let index = 0; index < artifact.length; index += 1) {
      artifact[index] = index % 251
    }
    const interruptedAt = 128 * 1_024
    const etag = '"artifact-v1"'
    const requests: Array<{ range: string | null; ifRange: string | null }> = []
    let attempt = 0
    const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      requests.push({
        range: headers.get('range'),
        ifRange: headers.get('if-range')
      })
      attempt += 1
      if (attempt === 1) {
        return new Response(interruptedBody(artifact.subarray(0, interruptedAt)), {
          status: 200,
          headers: {
            'content-length': String(artifact.length),
            etag
          }
        })
      }
      return new Response(artifact.subarray(interruptedAt), {
        status: 206,
        headers: {
          'content-length': String(artifact.length - interruptedAt),
          'content-range': `bytes ${interruptedAt}-${artifact.length - 1}/${artifact.length}`,
          etag
        }
      })
    })
    const updater = createUpdater(fetch, updaterCacheDirectory)
    const log = vi.fn()
    const controller = bindElectronUpdaterResumableDownload(updater, {
      log
    })
    const options = downloadOptions(artifact)

    await expect(updater.httpExecutor.download(
      new URL('https://updates.example/Workbench-0.2.0.zip'),
      destination,
      options
    )).rejects.toThrow('simulated connection loss')

    const [cacheEntry] = await readdir(cacheDirectory)
    expect(cacheEntry).toBeDefined()
    await expect(stat(join(cacheDirectory, cacheEntry!, 'artifact.part')))
      .resolves.toMatchObject({ size: interruptedAt })

    controller.dispose()
    const resumedUpdater = createUpdater(fetch, updaterCacheDirectory)
    const resumedController = bindElectronUpdaterResumableDownload(
      resumedUpdater,
      { log }
    )
    await resumedUpdater.httpExecutor.download(
      new URL('https://updates.example/Workbench-0.2.0.zip'),
      destination,
      options
    )

    await expect(readFile(destination)).resolves.toEqual(artifact)
    expect(requests).toEqual([
      { range: null, ifRange: null },
      { range: `bytes=${interruptedAt}-`, ifRange: etag }
    ])
    expect(log).toHaveBeenCalledWith(
      `Workbench 更新断点续传: offset=${interruptedAt} total=${artifact.length}`
    )
    resumedController.dispose()
  })

  it('restarts safely when the server ignores the Range request', async () => {
    const root = await createTemporaryDirectory()
    const cacheDirectory = join(root, 'resume-cache')
    const destination = join(root, 'pending-update.exe')
    const artifact = Buffer.alloc(128 * 1_024, 7)
    const interruptedAt = 64 * 1_024
    const requests: Array<string | null> = []
    let attempt = 0
    const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
      requests.push(new Headers(init?.headers).get('range'))
      attempt += 1
      if (attempt === 1) {
        return new Response(interruptedBody(artifact.subarray(0, interruptedAt)), {
          status: 200,
          headers: {
            'content-length': String(artifact.length),
            etag: '"artifact-v1"'
          }
        })
      }
      return new Response(artifact, {
        status: 200,
        headers: {
          'content-length': String(artifact.length),
          etag: '"artifact-v2"'
        }
      })
    })
    const updater = createUpdater(fetch)
    const log = vi.fn()
    const controller = bindElectronUpdaterResumableDownload(updater, {
      cacheDirectory,
      log
    })
    const options = downloadOptions(artifact)

    await expect(updater.httpExecutor.download(
      new URL('https://updates.example/Workbench-0.2.0.exe'),
      destination,
      options
    )).rejects.toThrow('simulated connection loss')
    await updater.httpExecutor.download(
      new URL('https://updates.example/Workbench-0.2.0.exe'),
      destination,
      options
    )

    expect(requests).toEqual([null, `bytes=${interruptedAt}-`])
    await expect(readFile(destination)).resolves.toEqual(artifact)
    expect(log).toHaveBeenCalledWith(
      'Workbench 更新断点续传: 服务端未接受 Range，已安全地从头下载'
    )
    controller.dispose()
  })

  it('discards a completed partial file when its published checksum fails', async () => {
    const root = await createTemporaryDirectory()
    const cacheDirectory = join(root, 'resume-cache')
    const destination = join(root, 'pending-update.zip')
    const expectedArtifact = Buffer.from('expected signed update')
    const corruptArtifact = Buffer.from('corrupted update data')
    const fetch = vi.fn(async () => new Response(corruptArtifact, {
      status: 200,
      headers: { 'content-length': String(corruptArtifact.length) }
    }))
    const updater = createUpdater(fetch)
    const controller = bindElectronUpdaterResumableDownload(updater, {
      cacheDirectory,
      log: vi.fn()
    })

    await expect(updater.httpExecutor.download(
      new URL('https://updates.example/Workbench-0.2.0.zip'),
      destination,
      downloadOptions(expectedArtifact)
    )).rejects.toThrow('SHA512 校验失败')

    await expect(readdir(cacheDirectory)).resolves.toEqual([])
    controller.dispose()
  })

  it('keeps pause and resume effective for the resumable response stream', async () => {
    const root = await createTemporaryDirectory()
    const cacheDirectory = join(root, 'resume-cache')
    const destination = join(root, 'pending-update.zip')
    const artifact = Buffer.alloc(64 * 1_024, 11)
    const updater = createUpdater(async () => new Response(artifact, {
      status: 200,
      headers: { 'content-length': String(artifact.length) }
    }))
    const controller = bindElectronUpdaterResumableDownload(updater, {
      cacheDirectory,
      log: vi.fn()
    })
    expect(controller.pause()).toBe(true)
    let settled = false

    const download = updater.httpExecutor.download(
      new URL('https://updates.example/Workbench-0.2.0.zip'),
      destination,
      downloadOptions(artifact)
    ).finally(() => {
      settled = true
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(settled).toBe(false)

    expect(controller.resume()).toBe(true)
    await download
    await expect(readFile(destination)).resolves.toEqual(artifact)
    controller.dispose()
  })
})

function createUpdater(
  fetch: (input: string, init?: RequestInit) => Promise<Response>,
  updaterCacheDirectory?: string
) {
  return {
    netSession: { fetch },
    ...(updaterCacheDirectory
      ? {
          downloadedUpdateHelper: {
            cacheDir: updaterCacheDirectory
          }
        }
      : {}),
    httpExecutor: {
      download: vi.fn(async () => {
        throw new Error('original download must not run')
      }) as (
        url: URL,
        destination: string,
        options: ReturnType<typeof downloadOptions>
      ) => Promise<unknown>
    }
  }
}

function downloadOptions(artifact: Buffer) {
  return {
    cancellationToken: {
      cancelled: false,
      createPromise<T>(
        task: (
          resolve: (value: T | PromiseLike<T>) => void,
          reject: (reason: Error) => void,
          onCancel: (handler: () => void) => void
        ) => void
      ): Promise<T> {
        return new Promise<T>((resolve, reject) => {
          task(resolve, reject, () => undefined)
        })
      }
    },
    sha512: createHash('sha512').update(artifact).digest('base64'),
    onProgress: vi.fn()
  }
}

function interruptedBody(firstChunk: Buffer): ReadableStream<Uint8Array> {
  let emitted = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!emitted) {
        emitted = true
        controller.enqueue(firstChunk)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
      controller.error(new Error('simulated connection loss'))
    }
  })
}

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'unilab-update-resume-'))
  temporaryDirectories.push(directory)
  return directory
}
