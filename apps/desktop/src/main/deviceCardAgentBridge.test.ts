import { readFile, rm, stat, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { connect, type Socket } from 'node:net'
import { createInterface } from 'node:readline'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import type {
  DeviceCardAgentBridgeDescriptor,
  DeviceCardAgentRpcResponse
} from '@unilab/device-card-sdk'
import type { DeviceCardAuthoringAutomation } from '@unilab/device-card-host'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DeviceCardAgentBridge } from './deviceCardAgentBridge'

const roots: string[] = []
const execFileAsync = promisify(execFile)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ))
})

describe('DeviceCardAgentBridge', () => {
  it.runIf(process.platform !== 'win32')(
    'requires the descriptor token and exposes only whitelisted methods',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'unilab-agent-bridge-'))
      roots.push(root)
      const endpoint = join(root, 'bridge.sock')
      const automation = fakeAutomation()
      const bridge = new DeviceCardAgentBridge({
        automation,
        agentRoot: root,
        endpoint,
        log: vi.fn()
      })
      await bridge.start()
      const descriptor = JSON.parse(
        await readFile(bridge.descriptorPath, 'utf8')
      ) as DeviceCardAgentBridgeDescriptor
      expect((await stat(bridge.descriptorPath)).mode & 0o777).toBe(0o600)

      const rejected = await openRpc(endpoint)
      const bad = await rejected.call('agent.handshake', {
        protocolVersion: 1,
        clientVersion: 'test',
        clientPid: process.pid,
        nonce: 'bad-nonce',
        capabilityToken: 'wrong'
      })
      expect(bad).toMatchObject({
        error: { code: 'AUTHENTICATION_FAILED' }
      })
      rejected.close()

      const accepted = await openRpc(endpoint)
      await expect(accepted.call('agent.handshake', {
        protocolVersion: 1,
        clientVersion: 'test',
        clientPid: process.pid,
        nonce: 'valid-nonce',
        capabilityToken: descriptor.capabilityToken
      })).resolves.toMatchObject({ result: { protocolVersion: 1 } })
      await expect(accepted.call('authoring.targets.list', {}))
        .resolves.toMatchObject({
          result: { devices: [{ deviceId: 'robot-01' }] }
        })
      expect(automation.listTargets).toHaveBeenCalledOnce()
      accepted.close()
      await bridge.stop()
    }
  )

  it.runIf(process.platform !== 'win32')(
    'serves the bundled thin CLI over the authenticated socket',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'unilab-agent-cli-'))
      roots.push(root)
      const bridge = new DeviceCardAgentBridge({
        automation: fakeAutomation(),
        agentRoot: root,
        endpoint: join(root, 'bridge.sock'),
        log: vi.fn()
      })
      await bridge.start()

      const cliPath = resolve(
        process.cwd(),
        '../../packages/device-card-agent-cli/dist/cli.mjs'
      )
      const { stdout, stderr } = await execFileAsync(process.execPath, [
        cliPath,
        'devices',
        'list',
        '--json'
      ], {
        env: {
          ...process.env,
          UNILAB_CARD_AGENT_DESCRIPTOR: bridge.descriptorPath
        }
      })
      expect(stderr).toBe('')
      expect(JSON.parse(stdout)).toMatchObject({
        schemaVersion: 'device-card-agent-result/v1',
        ok: true,
        devices: [{ deviceId: 'robot-01' }]
      })
      await bridge.stop()
    }
  )
})

function fakeAutomation(): DeviceCardAuthoringAutomation {
  return {
    listTargets: vi.fn(async () => [{
      deviceId: 'robot-01',
      deviceTypeId: 'robot-arm',
      title: 'Robot',
      online: true,
      actionCount: 0,
      contextAvailability: 'partial' as const
    }]),
    prepare: vi.fn(),
    getStatus: vi.fn(),
    recheck: vi.fn(),
    exportKit: vi.fn(),
    exportSource: vi.fn(),
    requestInstall: vi.fn(),
    close: vi.fn()
  }
}

async function openRpc(endpoint: string): Promise<{
  call: (
    method: string,
    params: Record<string, unknown>
  ) => Promise<DeviceCardAgentRpcResponse>
  close: () => void
}> {
  const socket = await new Promise<Socket>((resolveSocket, reject) => {
    const candidate = connect(endpoint)
    candidate.once('connect', () => resolveSocket(candidate))
    candidate.once('error', reject)
  })
  const lines = createInterface({ input: socket, crlfDelay: Infinity })
  const iterator = lines[Symbol.asyncIterator]()
  let sequence = 0
  return {
    call: async (method, params) => {
      sequence += 1
      socket.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: String(sequence),
        method,
        params
      })}\n`)
      const next = await iterator.next()
      if (next.done) throw new Error('Bridge closed before response.')
      return JSON.parse(next.value) as DeviceCardAgentRpcResponse
    },
    close: () => {
      lines.close()
      socket.end()
    }
  }
}
