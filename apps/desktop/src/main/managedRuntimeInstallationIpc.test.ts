import { describe, expect, it, vi } from 'vitest'

import type { ManagedRuntimeInstallation } from './managedRuntimeInstallation'
import { ManagedRuntimeInstallationController } from './managedRuntimeInstallationIpc'

const paths = {
  prefix: '/data/managed-runtime/versions/0.11.3-osx-arm64',
  runtimeVersion: '0.11.3',
  platform: 'osx-arm64' as const,
  pythonExecutable: '/data/managed-runtime/versions/0.11.3-osx-arm64/bin/python',
  unilabExecutable: '/data/managed-runtime/versions/0.11.3-osx-arm64/bin/unilab',
  supervisorExecutable:
    '/data/managed-runtime/versions/0.11.3-osx-arm64/bin/unilab-supervisor',
  manifestSha256: 'a'.repeat(64)
}

describe('ManagedRuntimeInstallationController', () => {
  it('offers the bundled installer only when no usable environment exists', async () => {
    const controller = createController({
      inspect: vi.fn(async () => ({ installed: false, paths })),
      ensureInstalled: vi.fn()
    })

    await expect(controller.initialize()).resolves.toMatchObject({
      phase: 'not-installed',
      bundled: true,
      environmentPath: null,
      runtimeVersion: '0.11.3'
    })
  })

  it('publishes installing and ready without accepting renderer paths', async () => {
    let finish: ((value: typeof paths) => void) | undefined
    const pending = new Promise<typeof paths>(resolve => { finish = resolve })
    const sent: unknown[] = []
    const onEnvironmentReady = vi.fn()
    const controller = createController({
      inspect: vi.fn(async () => ({ installed: false, paths })),
      ensureInstalled: vi.fn(() => pending)
    }, {
      onEnvironmentReady,
      getMainWindow: () => ({
        isDestroyed: () => false,
        webContents: { send: (_channel: string, value: unknown) => sent.push(value) }
      })
    })
    await controller.initialize()

    const installation = controller.install()
    expect(controller.getSnapshot().phase).toBe('installing')
    finish!(paths)
    await expect(installation).resolves.toMatchObject({
      phase: 'ready',
      managed: true,
      environmentPath: paths.prefix
    })
    expect(onEnvironmentReady).toHaveBeenCalledWith(paths.prefix)
    expect(sent).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'installing' }),
      expect.objectContaining({ phase: 'ready' })
    ]))
  })

  it('keeps a discovered external environment usable when payload inspection fails', async () => {
    const controller = createController({
      inspect: vi.fn(async () => { throw new Error('manifest damaged') }),
      ensureInstalled: vi.fn()
    }, {
      discoverExistingEnvironments: async () => ['/opt/conda/envs/unilab']
    })

    await expect(controller.initialize()).resolves.toMatchObject({
      phase: 'external',
      environmentPath: '/opt/conda/envs/unilab',
      error: 'manifest damaged'
    })
  })

  it('lists and switches between bundled and local UniLabOS environments', async () => {
    const onEnvironmentReady = vi.fn()
    const controller = createController({
      inspect: vi.fn(async () => ({ installed: true, paths })),
      ensureInstalled: vi.fn()
    }, {
      discoverExistingEnvironments: async () => ['/opt/conda/envs/unilab'],
      onEnvironmentReady
    })

    const initial = await controller.initialize()
    expect(initial.availableEnvironments).toEqual([
      expect.objectContaining({ kind: 'managed', path: paths.prefix }),
      expect.objectContaining({ kind: 'external', path: '/opt/conda/envs/unilab' })
    ])

    await expect(controller.selectEnvironment('/opt/conda/envs/unilab')).resolves.toMatchObject({
      phase: 'external',
      managed: false,
      environmentPath: '/opt/conda/envs/unilab'
    })
    expect(onEnvironmentReady).toHaveBeenLastCalledWith('/opt/conda/envs/unilab')
  })

  it('validates and persists a manually selected environment', async () => {
    const writeSelectedEnvironment = vi.fn(async () => undefined)
    const validateExistingEnvironment = vi.fn(
      async (path: string) => `${path}/resolved`
    )
    const onEnvironmentReady = vi.fn()
    const controller = createController({
      inspect: vi.fn(async () => ({ installed: false, paths })),
      ensureInstalled: vi.fn()
    }, {
      chooseExistingEnvironment: async () => '/Volumes/Lab/miniforge/envs/custom',
      validateExistingEnvironment,
      writeSelectedEnvironment,
      onEnvironmentReady
    })
    await controller.initialize()

    await expect(controller.chooseEnvironment()).resolves.toMatchObject({
      phase: 'external',
      managed: false,
      environmentPath: '/Volumes/Lab/miniforge/envs/custom/resolved'
    })
    expect(validateExistingEnvironment).toHaveBeenCalledWith(
      '/Volumes/Lab/miniforge/envs/custom'
    )
    expect(writeSelectedEnvironment).toHaveBeenCalledWith(
      '/Volumes/Lab/miniforge/envs/custom/resolved'
    )
    expect(onEnvironmentReady).toHaveBeenLastCalledWith(
      '/Volumes/Lab/miniforge/envs/custom/resolved'
    )
  })

  it('restores a persisted external environment ahead of bundled Runtime', async () => {
    const onEnvironmentReady = vi.fn()
    const controller = createController({
      inspect: vi.fn(async () => ({ installed: true, paths })),
      ensureInstalled: vi.fn()
    }, {
      discoverExistingEnvironments: async () => [
        '/opt/conda/envs/unilab',
        '/opt/conda/envs/szlab-unilab'
      ],
      readSelectedEnvironment: async () => '/opt/conda/envs/szlab-unilab',
      onEnvironmentReady
    })

    await expect(controller.initialize()).resolves.toMatchObject({
      phase: 'external',
      environmentPath: '/opt/conda/envs/szlab-unilab',
      availableEnvironments: [
        expect.objectContaining({ kind: 'managed', path: paths.prefix }),
        expect.objectContaining({ path: '/opt/conda/envs/unilab' }),
        expect.objectContaining({ path: '/opt/conda/envs/szlab-unilab' })
      ]
    })
    expect(onEnvironmentReady).toHaveBeenLastCalledWith(
      '/opt/conda/envs/szlab-unilab'
    )
  })
})

function createController(
  installation: Pick<ManagedRuntimeInstallation, 'inspect' | 'ensureInstalled'>,
  overrides: Record<string, unknown> = {}
): ManagedRuntimeInstallationController {
  return new ManagedRuntimeInstallationController({
    ipcMain: {} as never,
    installation: installation as ManagedRuntimeInstallation,
    discoverExistingEnvironments: async () => [],
    validateExistingEnvironment: async (path: string) => path,
    chooseExistingEnvironment: async () => null,
    readSelectedEnvironment: async () => null,
    writeSelectedEnvironment: async () => undefined,
    assertSender: () => undefined,
    getMainWindow: () => null,
    onEnvironmentReady: () => undefined,
    log: () => undefined,
    ...overrides
  } as never)
}
