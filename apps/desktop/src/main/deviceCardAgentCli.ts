import {
  access,
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

import type { DeviceCardAgentEnvironmentInfo } from '@unilab/device-card-sdk'

export class DeviceCardAgentCliManager {
  readonly installPath: string

  constructor(private readonly options: {
    cliPath: string
    descriptorPath: string
    electronExecutable: string
  }) {
    this.installPath = defaultInstallPath()
  }

  async getInfo(bridgeEnabled: boolean): Promise<DeviceCardAgentEnvironmentInfo> {
    const installed = await exists(this.installPath)
    const compatible = installed && await this.isCompatible()
    return {
      bridge: { enabled: bridgeEnabled, protocolVersion: 1 },
      cli: {
        installed,
        compatible,
        installPath: this.installPath,
        onPath: pathContains(dirname(this.installPath)),
        command: installed ? this.installPath : 'unilab-card-agent'
      }
    }
  }

  async install(): Promise<void> {
    await Promise.all([
      access(resolve(this.options.cliPath)),
      mkdir(dirname(this.installPath), { recursive: true })
    ])
    const temporary = `${this.installPath}.tmp`
    await writeFile(
      temporary,
      this.launcher(),
      { encoding: 'utf8', mode: 0o755 }
    )
    if (process.platform !== 'win32') await chmod(temporary, 0o755)
    if (process.platform === 'win32') {
      await rm(this.installPath, { force: true })
    }
    await rename(temporary, this.installPath)
  }

  async remove(): Promise<void> {
    await rm(this.installPath, { force: true })
  }

  private async isCompatible(): Promise<boolean> {
    try {
      return await readFile(this.installPath, 'utf8') === this.launcher()
    } catch {
      return false
    }
  }

  private launcher(): string {
    return process.platform === 'win32'
      ? windowsLauncher(this.options)
      : posixLauncher(this.options)
  }
}

function defaultInstallPath(): string {
  if (process.platform === 'win32') {
    return join(
      process.env['LOCALAPPDATA'] || join(homedir(), 'AppData', 'Local'),
      'Uni-Lab',
      'bin',
      'unilab-card-agent.cmd'
    )
  }
  return join(homedir(), '.local', 'bin', 'unilab-card-agent')
}

function posixLauncher(options: {
  cliPath: string
  descriptorPath: string
  electronExecutable: string
}): string {
  return `#!/bin/sh
export ELECTRON_RUN_AS_NODE=1
export UNILAB_CARD_AGENT_DESCRIPTOR=${shellQuote(options.descriptorPath)}
export UNILAB_ELECTRON_EXECUTABLE=${shellQuote(options.electronExecutable)}
exec ${shellQuote(options.electronExecutable)} ${shellQuote(options.cliPath)} "$@"
`
}

function windowsLauncher(options: {
  cliPath: string
  descriptorPath: string
  electronExecutable: string
}): string {
  for (const value of Object.values(options)) {
    if (value.includes('\n') || value.includes('\r') || value.includes('"')) {
      throw new Error('CLI 路径包含 Windows launcher 不支持的字符。')
    }
  }
  return `@echo off\r
set "ELECTRON_RUN_AS_NODE=1"\r
set "UNILAB_CARD_AGENT_DESCRIPTOR=${options.descriptorPath}"\r
set "UNILAB_ELECTRON_EXECUTABLE=${options.electronExecutable}"\r
"${options.electronExecutable}" "${options.cliPath}" %*\r
`
}

function shellQuote(value: string): string {
  if (value.includes('\n') || value.includes('\r')) {
    throw new Error('CLI 路径不能包含换行符。')
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function pathContains(directory: string): boolean {
  const normalized = resolve(directory)
  return (process.env['PATH'] ?? '')
    .split(delimiter)
    .some((candidate) => candidate && resolve(candidate) === normalized)
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
