import { resolve } from 'node:path'

import type { DeviceCardAgentMethod } from '@unilab/device-card-sdk'

export interface ParsedAgentCommand {
  method: DeviceCardAgentMethod
  params: Record<string, unknown>
  json: boolean
  launchElectron: boolean
  requireReady: boolean
  waitWithoutRevision: boolean
}

const VALUE_OPTIONS = new Set([
  '--device-id',
  '--profile',
  '--out',
  '--dir',
  '--project',
  '--session-id',
  '--after-revision',
  '--timeout'
])
const BOOLEAN_OPTIONS = new Set([
  '--json',
  '--launch-electron',
  '--replace',
  '--wait',
  '--require-ready'
])

export function parseAgentCommand(argv: string[]): ParsedAgentCommand {
  if (argv.length < 2) usageError('缺少命令。')
  const [group, action, ...rest] = argv
  const options = parseOptions(rest)
  const common = {
    json: options.flags.has('--json'),
    launchElectron: options.flags.has('--launch-electron'),
    requireReady: options.flags.has('--require-ready'),
    waitWithoutRevision: false
  }

  if (group === 'devices' && action === 'list') {
    assertOnly(options, ['--json', '--launch-electron'])
    return { ...common, method: 'authoring.targets.list', params: {} }
  }
  if (group === 'kit' && action === 'export') {
    assertOnly(options, [
      '--device-id', '--profile', '--out', '--json', '--launch-electron'
    ])
    return {
      ...common,
      method: 'authoring.kit.export',
      params: {
        deviceId: required(options, '--device-id'),
        profile: options.values.get('--profile') ?? 'vue',
        destination: resolve(required(options, '--out'))
      }
    }
  }
  if (group === 'authoring' && action === 'bootstrap') {
    assertOnly(options, [
      '--device-id', '--profile', '--dir', '--replace', '--json',
      '--launch-electron'
    ])
    return {
      ...common,
      method: 'authoring.session.prepare',
      params: {
        deviceId: required(options, '--device-id'),
        profile: options.values.get('--profile') ?? 'vue',
        projectDir: resolve(required(options, '--dir')),
        replace: options.flags.has('--replace')
      }
    }
  }
  if (group === 'workspace' && action === 'attach') {
    assertOnly(options, [
      '--device-id', '--project', '--replace', '--json', '--launch-electron'
    ])
    return {
      ...common,
      method: 'authoring.session.attach',
      params: {
        deviceId: required(options, '--device-id'),
        projectDir: resolve(required(options, '--project')),
        replace: options.flags.has('--replace')
      }
    }
  }
  if (group === 'workspace' && action === 'status') {
    assertOnly(options, [
      '--project', '--session-id', '--wait', '--after-revision', '--timeout',
      '--require-ready', '--json', '--launch-electron'
    ])
    const workspaceLocator = locator(options)
    const wait = options.flags.has('--wait')
    const after = optionalInteger(options, '--after-revision')
    return {
      ...common,
      waitWithoutRevision: wait && after === undefined,
      method: 'authoring.session.get',
      params: {
        ...workspaceLocator,
        ...(wait && after !== undefined ? { afterRevision: after } : {}),
        ...(wait ? {
          timeoutMs: 1000 * (optionalInteger(options, '--timeout') ?? 120)
        } : {})
      }
    }
  }
  if (group === 'workspace' && action === 'recheck') {
    assertOnly(options, locatorOptions())
    return {
      ...common,
      method: 'authoring.session.recheck',
      params: locator(options)
    }
  }
  if (group === 'workspace' && action === 'export') {
    assertOnly(options, [...locatorOptions(), '--out'])
    return {
      ...common,
      method: 'authoring.session.export',
      params: {
        ...locator(options),
        destination: resolve(required(options, '--out'))
      }
    }
  }
  if (group === 'workspace' && action === 'install') {
    assertOnly(options, locatorOptions())
    return {
      ...common,
      method: 'authoring.session.install.request',
      params: locator(options)
    }
  }
  if (group === 'workspace' && action === 'detach') {
    assertOnly(options, locatorOptions())
    return {
      ...common,
      method: 'authoring.session.close',
      params: locator(options)
    }
  }
  usageError(`未知命令：${group} ${action}`)
}

export function helpText(): string {
  return `Uni-Lab Device Card Agent CLI

用法：
  unilab-card-agent devices list --json
  unilab-card-agent kit export --device-id ID --profile vue --out KIT.zip --json
  unilab-card-agent authoring bootstrap --device-id ID --profile vue --dir DIR --json
  unilab-card-agent workspace attach --device-id ID --project DIR --json
  unilab-card-agent workspace status --project DIR [--wait] [--timeout 120] --json
  unilab-card-agent workspace recheck --project DIR --json
  unilab-card-agent workspace export --project DIR --out CARD.ulcard --json
  unilab-card-agent workspace install --project DIR --json
  unilab-card-agent workspace detach --project DIR --json
`
}

interface ParsedOptions {
  values: Map<string, string>
  flags: Set<string>
  seen: Set<string>
}

function parseOptions(args: string[]): ParsedOptions {
  const options: ParsedOptions = {
    values: new Map(),
    flags: new Set(),
    seen: new Set()
  }
  for (let index = 0; index < args.length; index += 1) {
    const name = args[index]
    if (options.seen.has(name)) usageError(`参数重复：${name}`)
    options.seen.add(name)
    if (BOOLEAN_OPTIONS.has(name)) {
      options.flags.add(name)
      continue
    }
    if (!VALUE_OPTIONS.has(name)) usageError(`未知参数：${name}`)
    const value = args[index + 1]
    if (!value || value.startsWith('--')) usageError(`${name} 缺少值。`)
    options.values.set(name, value)
    index += 1
  }
  return options
}

function assertOnly(options: ParsedOptions, allowed: string[]): void {
  const names = new Set(allowed)
  for (const name of options.seen) {
    if (!names.has(name)) usageError(`当前命令不支持参数：${name}`)
  }
}

function locatorOptions(): string[] {
  return ['--project', '--session-id', '--json', '--launch-electron']
}

function locator(options: ParsedOptions): Record<string, string> {
  const project = options.values.get('--project')
  const sessionId = options.values.get('--session-id')
  if (Boolean(project) === Boolean(sessionId)) {
    usageError('必须且只能提供 --project 或 --session-id。')
  }
  return project
    ? { projectDir: resolve(project) }
    : { sessionId: sessionId as string }
}

function required(options: ParsedOptions, name: string): string {
  const value = options.values.get(name)
  if (!value) usageError(`缺少参数：${name}`)
  return value
}

function optionalInteger(
  options: ParsedOptions,
  name: string
): number | undefined {
  const value = options.values.get(name)
  if (value === undefined) return undefined
  const number = Number(value)
  if (!Number.isInteger(number) || number < 0) {
    usageError(`${name} 必须是非负整数。`)
  }
  return number
}

function usageError(message: string): never {
  const error = new Error(message) as Error & { code: string }
  error.code = 'INVALID_ARGUMENT'
  throw error
}
