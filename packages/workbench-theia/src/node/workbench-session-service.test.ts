import type {
  WorkbenchSession,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import { describe, expect, it, vi } from 'vitest'

import type { WorkbenchSessionClient } from '../common/workbench-session-protocol'
import {
  configuredWorkbenchDomainMode,
  readableRuntimeLogPath,
  sanitizeRuntimeLogForEditor,
  workspaceBackendAutostartEnabled,
  WorkbenchSessionService
} from './workbench-session-service'

describe('WorkbenchSessionService', () => {
  it('selects backend-only container startup without guessing other values', () => {
    expect(configuredWorkbenchDomainMode({
      UNILAB_WORKBENCH_DOMAIN_MODE: 'backend'
    })).toBe('backend')
    expect(configuredWorkbenchDomainMode({
      UNILAB_WORKBENCH_DOMAIN_MODE: 'unexpected'
    })).toBe('local')
    expect(workspaceBackendAutostartEnabled({
      UNILAB_WORKSPACE_BACKEND_ENABLED: '0'
    })).toBe(false)
  })

  it('does not launch local Python services in backend-only mode', async () => {
    const startAgent = vi.fn().mockResolvedValue(snapshot('idle', null))
    const startWorkspaceBackend = vi.fn().mockResolvedValue(snapshot('ready', 41))
    const refreshPlcVariableTables = vi.fn().mockResolvedValue(snapshot('idle', null))
    const session = {
      startAgent,
      startWorkspaceBackend,
      refreshPlcVariableTables
    } as unknown as WorkbenchSession
    const service = new WorkbenchSessionService()
    Object.assign(service, { session, workspaceBackendEnabled: false })

    service.onStart()
    await vi.waitFor(() => expect(startAgent).toHaveBeenCalledOnce())
    expect(startWorkspaceBackend).not.toHaveBeenCalled()
    expect(refreshPlcVariableTables).not.toHaveBeenCalled()
  })

  it('starts Workspace Backend and Agent when the Theia backend opens', async () => {
    const startAgent = vi.fn().mockResolvedValue(snapshot('idle', null))
    const startWorkspaceBackend = vi.fn().mockResolvedValue(
      snapshot('ready', 41)
    )
    const session = {
      startAgent,
      startWorkspaceBackend,
      refreshPlcVariableTables: vi.fn().mockResolvedValue(snapshot('idle', null))
    } as unknown as WorkbenchSession
    const service = new WorkbenchSessionService()
    Object.assign(service, { session })

    service.onStart()
    await vi.waitFor(() => expect(startAgent).toHaveBeenCalledOnce())
    expect(startWorkspaceBackend).toHaveBeenCalledOnce()
  })

  it('publishes one managed session snapshot to every connected renderer', () => {
    const initial = snapshot('starting', null)
    const restarted = snapshot('ready', 59682)
    const listeners = new Set<(value: WorkbenchSessionSnapshot) => void>()
    const session = {
      getSnapshot: () => initial,
      onDidChange: (listener: (value: WorkbenchSessionSnapshot) => void) => {
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
      }
    } as unknown as WorkbenchSession
    const service = new WorkbenchSessionService()
    Object.assign(service, { session })
    const desktop = client()
    const browser = client()

    service.setClient(desktop)
    service.setClient(browser)
    expect(listeners).toHaveLength(1)
    for (const listener of listeners) listener(restarted)

    expect(desktop.onDidChange).toHaveBeenLastCalledWith(restarted)
    expect(browser.onDidChange).toHaveBeenLastCalledWith(restarted)
  })

  it('keeps a renderer after an asynchronous callback acknowledgement fails', async () => {
    const initial = snapshot('starting', null)
    const restarted = snapshot('ready', 59682)
    const listeners = new Set<(value: WorkbenchSessionSnapshot) => void>()
    const session = {
      getSnapshot: () => initial,
      onDidChange: (listener: (value: WorkbenchSessionSnapshot) => void) => {
        listeners.add(listener)
        return { dispose: () => listeners.delete(listener) }
      }
    } as unknown as WorkbenchSession
    const service = new WorkbenchSessionService()
    Object.assign(service, { session })
    const renderer = {
      onDidChange: vi.fn().mockRejectedValue(new Error('acknowledgement failed')),
      onMaterialRendererRequest: vi.fn()
    }

    service.setClient(renderer)
    await Promise.resolve()
    for (const listener of listeners) listener(restarted)

    expect(renderer.onDidChange).toHaveBeenLastCalledWith(restarted)
  })

  it('routes automation only to the latest connected renderer', async () => {
    const session = {
      getSnapshot: () => snapshot('ready', 59682),
      onDidChange: () => ({ dispose: vi.fn() })
    } as unknown as WorkbenchSession
    const service = new WorkbenchSessionService()
    Object.assign(service, { session })
    const first = client()
    const second = client()
    vi.mocked(second.onMaterialRendererRequest).mockImplementation(request => {
      void service.completeMaterialRendererRequest({
        schemaVersion: 'unilab-material-renderer/v1',
        requestId: request.requestId,
        ok: true,
        result: { nodes: [] }
      })
    })

    service.setClient(first)
    service.setClient(second)
    const response = await service.requestMaterialRenderer({
      requestId: 'request-1',
      kind: 'inspect',
      options: {}
    })

    expect(first.onMaterialRendererRequest).not.toHaveBeenCalled()
    expect(second.onMaterialRendererRequest).toHaveBeenCalledOnce()
    expect(response.ok).toBe(true)
  })

  it('removes terminal control sequences without changing log lines', () => {
    const raw = '\u001b[34m[INFO]\u001b[0m ready\n\u001b]0;runtime\u0007next line'

    expect(sanitizeRuntimeLogForEditor(raw)).toBe('[INFO] ready\nnext line')
  })

  it('uses a separate readable file beside the source log', () => {
    expect(readableRuntimeLogPath('/workspace/logs/os.log')).toBe(
      '/workspace/logs/.readable/os.readable.log'
    )
  })
})

function client(): WorkbenchSessionClient {
  return {
    onDidChange: vi.fn(),
    onMaterialRendererRequest: vi.fn()
  }
}

function snapshot(
  phase: WorkbenchSessionSnapshot['phase'],
  pid: number | null
): WorkbenchSessionSnapshot {
  return {
    phase,
    message: phase,
    configuredGraphPath: 'deployment/graphs/szlab-plc-sim-local.json',
    configuredExternalDevicesOnly: true,
    configuredRuntimeMode: 'normal',
    configuredDomainMode: 'local',
    configuredBackendUrl: null,
    configuredSchedulerUrl: null,
    agent: null,
    identity: pid === null ? null : {
      workspacePath: '/workspace',
      osProjectPath: '/os',
      osRuntimeSource: 'checkout',
      environmentPath: '/python',
      graphPath: '/workspace/deployment/graphs/szlab-plc-sim-local.json',
      graphFingerprint: 'graph',
      backendUrl: 'http://127.0.0.1:62201',
      pid,
      generation: 'generation',
      logPath: '/log',
      mode: 'normal',
      packageMounts: null,
      agent: null
    },
    diagnostic: null,
    edgeRuntime: {
      phase: pid === null ? 'idle' : 'ready',
      message: pid === null ? 'idle' : 'ready',
      pid,
      generation: pid === null ? null : 'edge-generation',
      graphPath: '/workspace/deployment/graphs/szlab-plc-sim-local.json',
      mode: 'normal',
      logPath: pid === null ? '' : '/edge-log',
      diagnostic: null
    },
    plcSimulator: {
      phase: 'idle',
      message: 'idle',
      projectPath: '',
      variableTablePath: '',
      variableTableCandidates: [],
      handshakeProfile: 'szlab',
      pid: null,
      guiUrl: 'http://127.0.0.1:18765',
      opcUaUrl: 'opc.tcp://127.0.0.1:4855',
      logPath: '',
      diagnostic: null
    }
  }
}
