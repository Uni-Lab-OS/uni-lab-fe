import type {
  WorkbenchSession,
  WorkbenchSessionSnapshot
} from '@unilab/workbench-session'
import { describe, expect, it, vi } from 'vitest'

import type { WorkbenchSessionClient } from '../common/workbench-session-protocol'
import { WorkbenchSessionService } from './workbench-session-service'

describe('WorkbenchSessionService', () => {
  it('starts the Workspace Agent when the backend opens, before OS startup', async () => {
    const startAgent = vi.fn().mockResolvedValue(snapshot('idle', null))
    const session = {
      startAgent,
      refreshPlcVariableTables: vi.fn().mockResolvedValue(snapshot('idle', null))
    } as unknown as WorkbenchSession
    const service = new WorkbenchSessionService()
    Object.assign(service, { session })

    service.onStart()
    await vi.waitFor(() => expect(startAgent).toHaveBeenCalledOnce())
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
      onDidChange: vi.fn().mockRejectedValue(new Error('acknowledgement failed'))
    }

    service.setClient(renderer)
    await Promise.resolve()
    for (const listener of listeners) listener(restarted)

    expect(renderer.onDidChange).toHaveBeenLastCalledWith(restarted)
  })
})

function client(): WorkbenchSessionClient {
  return { onDidChange: vi.fn() }
}

function snapshot(
  phase: WorkbenchSessionSnapshot['phase'],
  pid: number | null
): WorkbenchSessionSnapshot {
  return {
    phase,
    message: phase,
    configuredGraphPath: 'deployment/graphs/szlab-plc-sim-local.json',
    configuredSkipWorkflowSourceActivation: false,
    configuredRuntimeMode: 'normal',
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
