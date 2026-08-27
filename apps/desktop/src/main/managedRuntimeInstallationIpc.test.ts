import { describe, expect, it, vi } from 'vitest'

import type { ManagedRuntimeInstallation } from './managedRuntimeInstallation'
import {
  ManagedRuntimeInstallationController,
  runtimeEnvironmentFallbackAllowed
} from './managedRuntimeInstallationIpc'

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
const noSelection = {
  kind: 'none' as const,
  path: null,
  runtimeVersion: null
}

describe('ManagedRuntimeInstallationController', () => {
  it('offers the bundled installer only when no usable environment exists', async () => {
    const controller = createController({
      inspect: vi.fn(async () => ({ installed: false, paths, selection: noSelection })),
      ensureInstalled: vi.fn()
    })

    await expect(controller.initialize()).resolves.toMatchObject({
      phase: 'not-installed',
      bundled: true,
      environmentPath: null,
      runtimeVersion: '0.11.3'
    })
  })

  it('blocks a persisted older managed Runtime until the bundled upgrade succeeds', async () => {
    const previousPath = '/data/managed-runtime/versions/0.10.0-osx-arm64-old'
    const validateExistingEnvironment = vi.fn(async (path: string) => path)
    const controller = createController({
      inspect: vi.fn(async (...args: unknown[]) => {
        expect(args[0]).toBe(previousPath)
        return {
          installed: false,
          paths,
          selection: {
            kind: 'outdated-managed' as const,
            path: previousPath,
            runtimeVersion: '0.10.0'
          }
        }
      }),
      ensureInstalled: vi.fn()
    }, {
      readSelectedEnvironment: async () => previousPath,
      discoverExistingEnvironments: async () => [previousPath],
      validateExistingEnvironment
    })

    const snapshot = await controller.initialize()
    expect(snapshot).toMatchObject({
      phase: 'upgrade-required',
      bundled: true,
      managed: false,
      runtimeVersion: '0.11.3',
      environmentPath: null,
      previousRuntimeVersion: '0.10.0',
      previousEnvironmentPath: previousPath,
      errorCode: 'upgrade-required'
    })
    expect(runtimeEnvironmentFallbackAllowed(snapshot)).toBe(false)
    expect(validateExistingEnvironment).not.toHaveBeenCalledWith(previousPath)
  })

  it('switches a persisted older managed Runtime to an already valid bundled version', async () => {
    const previousPath = '/data/managed-runtime/versions/0.10.0-osx-arm64-old'
    const writeSelectedEnvironment = vi.fn(async () => undefined)
    const onEnvironmentReady = vi.fn()
    const controller = createController({
      inspect: vi.fn(async () => ({
        installed: true,
        paths,
        selection: {
          kind: 'outdated-managed' as const,
          path: previousPath,
          runtimeVersion: '0.10.0'
        }
      })),
      ensureInstalled: vi.fn()
    }, {
      readSelectedEnvironment: async () => previousPath,
      writeSelectedEnvironment,
      onEnvironmentReady
    })

    await expect(controller.initialize()).resolves.toMatchObject({
      phase: 'ready',
      managed: true,
      runtimeVersion: '0.11.3',
      environmentPath: paths.prefix,
      previousEnvironmentPath: null
    })
    expect(writeSelectedEnvironment).toHaveBeenCalledWith(paths.prefix)
    expect(onEnvironmentReady).toHaveBeenCalledWith(paths.prefix)
  })

  it('retains rollback details and diagnostics when a required upgrade fails', async () => {
    const previousPath = '/data/managed-runtime/versions/0.10.0-osx-arm64-old'
    const writeSelectedEnvironment = vi.fn(async () => undefined)
    const showDiagnosticLog = vi.fn(async () => undefined)
    const controller = createController({
      inspect: vi.fn(async () => ({
        installed: false,
        paths,
        selection: {
          kind: 'outdated-managed' as const,
          path: previousPath,
          runtimeVersion: '0.10.0'
        }
      })),
      ensureInstalled: vi.fn(async () => {
        throw new Error('Runtime 安装器执行失败；日志：/tmp/runtime-install.log')
      })
    }, {
      readSelectedEnvironment: async () => previousPath,
      writeSelectedEnvironment,
      showDiagnosticLog
    })
    await controller.initialize()

    await expect(controller.install()).rejects.toThrow('Runtime 安装器执行失败')
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'failed',
      environmentPath: null,
      previousRuntimeVersion: '0.10.0',
      previousEnvironmentPath: previousPath,
      errorCode: 'installation-failed',
      errorLogPath: '/tmp/runtime-install.log'
    })
    expect(writeSelectedEnvironment).not.toHaveBeenCalled()
    await expect(controller.openDiagnosticLog()).resolves.toBe(true)
    expect(showDiagnosticLog).toHaveBeenCalledWith('/tmp/runtime-install.log')
  })

  it('publishes installing and ready without accepting renderer paths', async () => {
    let finish: ((value: typeof paths) => void) | undefined
    const pending = new Promise<typeof paths>(resolve => { finish = resolve })
    const sent: unknown[] = []
    const onEnvironmentReady = vi.fn()
    const controller = createController({
      inspect: vi.fn(async () => ({ installed: false, paths, selection: noSelection })),
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

  it('blocks an older managed Runtime when payload inspection itself fails', async () => {
    const previousPath = '/data/managed-runtime/versions/0.10.0-osx-arm64-old'
    const validateExistingEnvironment = vi.fn(async (path: string) => path)
    const controller = createController({
      inspect: vi.fn(async () => { throw new Error('Runtime manifest 字段无效') }),
      classifySelection: vi.fn(async () => ({
        kind: 'outdated-managed' as const,
        path: previousPath,
        runtimeVersion: '0.10.0'
      })),
      ensureInstalled: vi.fn()
    }, {
      readSelectedEnvironment: async () => previousPath,
      discoverExistingEnvironments: async () => [previousPath],
      validateExistingEnvironment
    })

    const snapshot = await controller.initialize()

    expect(snapshot).toMatchObject({
      phase: 'failed',
      environmentPath: null,
      previousRuntimeVersion: '0.10.0',
      previousEnvironmentPath: previousPath,
      errorCode: 'payload-invalid'
    })
    expect(runtimeEnvironmentFallbackAllowed(snapshot)).toBe(false)
    expect(validateExistingEnvironment).not.toHaveBeenCalled()
  })

  it('lists and switches between bundled and local UniLabOS environments', async () => {
    const onEnvironmentReady = vi.fn()
    const controller = createController({
      inspect: vi.fn(async () => ({ installed: true, paths, selection: noSelection })),
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
      inspect: vi.fn(async () => ({ installed: false, paths, selection: noSelection })),
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
      inspect: vi.fn(async () => ({
        installed: true,
        paths,
        selection: {
          kind: 'external' as const,
          path: '/opt/conda/envs/szlab-unilab',
          runtimeVersion: null
        }
      })),
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
  installation: Pick<ManagedRuntimeInstallation, 'inspect' | 'ensureInstalled'>
    & Partial<Pick<ManagedRuntimeInstallation, 'classifySelection'>>,
  overrides: Record<string, unknown> = {}
): ManagedRuntimeInstallationController {
  return new ManagedRuntimeInstallationController({
    ipcMain: {} as never,
    installation: {
      classifySelection: async (path: string | null) => path
        ? { kind: 'external' as const, path, runtimeVersion: null }
        : { kind: 'none' as const, path: null, runtimeVersion: null },
      ...installation
    } as ManagedRuntimeInstallation,
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
