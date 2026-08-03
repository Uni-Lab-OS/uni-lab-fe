import {
  DEVICE_CARD_AGENT_RESULT_SCHEMA,
  type DeviceCardAgentErrorPayload,
  type DeviceCardAuthoringSessionStatus
} from '@unilab/device-card-sdk'

import { parseAgentCommand, helpText } from './args'
import { AgentCliError, callElectronBridge } from './client'

void main(process.argv.slice(2))

async function main(argv: string[]): Promise<void> {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(helpText())
    return
  }
  let json = argv.includes('--json')
  try {
    const command = parseAgentCommand(argv)
    json = command.json
    let result = await callElectronBridge(command.method, command.params, {
      launchElectron: command.launchElectron
    })
    if (command.waitWithoutRevision) {
      const first = result as DeviceCardAuthoringSessionStatus
      result = await callElectronBridge(command.method, {
        ...command.params,
        afterRevision: first.workspace.revision
      }, { launchElectron: false })
    }
    if (
      command.requireReady &&
      (result as DeviceCardAuthoringSessionStatus).workspace?.state !== 'ready'
    ) {
      throw new AgentCliError({
        code: 'BUILD_FAILED',
        message: '当前源码检查未通过。',
        retryable: true,
        details: { result }
      })
    }
    const output = {
      schemaVersion: DEVICE_CARD_AGENT_RESULT_SCHEMA,
      ok: true,
      ...(isRecord(result) ? result : { result })
    }
    writeOutput(output, json)
  } catch (error) {
    const payload = errorPayload(error)
    writeOutput({
      schemaVersion: DEVICE_CARD_AGENT_RESULT_SCHEMA,
      ok: false,
      error: payload
    }, json)
    process.exitCode = exitCode(payload)
  }
}
function writeOutput(value: unknown, json: boolean): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value)}\n`)
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
  }
}

function errorPayload(error: unknown): DeviceCardAgentErrorPayload {
  if (error instanceof AgentCliError) return error.payload
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate?.code === 'INVALID_ARGUMENT') {
    return {
      code: 'INVALID_ARGUMENT',
      message: String(candidate.message ?? 'CLI 参数无效。'),
      retryable: false,
      details: {}
    }
  }
  return {
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: false,
    details: {}
  }
}

function exitCode(error: DeviceCardAgentErrorPayload): number {
  if (error.code === 'INVALID_ARGUMENT') return 2
  if (
    error.code === 'ELECTRON_NOT_RUNNING' ||
    error.code === 'PROTOCOL_MISMATCH'
  ) return 3
  if (
    error.code === 'AUTHENTICATION_FAILED' ||
    error.code === 'AUTHORIZATION_DENIED'
  ) return 4
  if (
    error.code === 'OS_UNAVAILABLE' ||
    error.code === 'DEVICE_NOT_FOUND' ||
    error.code === 'DEVICE_ID_MISSING' ||
    error.code === 'DEVICE_TYPE_UNRESOLVED'
  ) return 5
  if (
    error.code === 'BUILD_FAILED' ||
    error.code === 'CURRENT_SOURCE_NOT_READY'
  ) return 6
  if (error.code === 'APPROVAL_TIMEOUT') return 7
  return 10
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
