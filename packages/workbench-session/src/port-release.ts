import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

interface CommandResult {
  stdout: string
  stderr: string
}

export type PortReleaseCommandRunner = (
  command: string,
  args: string[]
) => Promise<CommandResult>

export interface ReleaseLoopbackPortOptions {
  platform?: NodeJS.Platform
  commandRunner?: PortReleaseCommandRunner
  processKiller?: (pid: number, signal: NodeJS.Signals) => void
  currentProcessId?: number
  verificationAttempts?: number
  verificationDelayMs?: number
}

const execFileAsync = promisify(execFile)
const DEFAULT_VERIFICATION_ATTEMPTS = 20
const DEFAULT_VERIFICATION_DELAY_MS = 100

/** Release TCP listeners selected by the Environment Manager confirmation. */
export async function releaseLoopbackPorts(
  ports: readonly number[],
  options: ReleaseLoopbackPortOptions = {}
): Promise<number[]> {
  const normalizedPorts = normalizePorts(ports)
  if (normalizedPorts.length === 0) return []
  const platform = options.platform ?? process.platform
  const runner = options.commandRunner ?? runCommand
  const currentProcessId = options.currentProcessId ?? process.pid
  if (platform === 'win32') {
    return releaseWindowsPorts(
      normalizedPorts,
      runner,
      currentProcessId,
      options,
      options.processKiller ?? process.kill
    )
  }

  return releaseUnixPorts(
    normalizedPorts,
    platform,
    runner,
    currentProcessId,
    options,
    options.processKiller ?? process.kill
  )
}

async function releaseUnixPorts(
  ports: number[],
  platform: NodeJS.Platform,
  runner: PortReleaseCommandRunner,
  currentProcessId: number,
  options: ReleaseLoopbackPortOptions,
  processKiller: (pid: number, signal: NodeJS.Signals) => void
): Promise<number[]> {
  let processIds: number[]
  try {
    processIds = await queryUnixListenerProcessIds(
      ports,
      runner,
      currentProcessId
    )
  } catch (error) {
    throw unixReleaseError(platform, ports, error)
  }
  if (processIds.length === 0) return []

  const terminationErrors: string[] = []
  for (const processId of processIds) {
    try {
      processKiller(processId, 'SIGKILL')
    } catch (error) {
      if (!isMissingProcess(error)) {
        terminationErrors.push(`PID ${processId}: ${messageOf(error)}`)
      }
    }
  }

  const { attempts, delayMs } = verificationSettings(options)
  let remainingProcessIds: number[] = []
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      remainingProcessIds = await queryUnixListenerProcessIds(
        ports,
        runner,
        currentProcessId
      )
      if (remainingProcessIds.length === 0) return processIds
      if (attempt + 1 < attempts && delayMs > 0) await delay(delayMs)
    }
  } catch (error) {
    throw unixReleaseError(platform, ports, error)
  }

  const details = terminationErrors.length > 0
    ? `；终止进程错误：${terminationErrors.join('；')}`
    : ''
  throw new Error(
    `${platformName(platform)} 释放端口 ${ports.join('、')} 失败：端口仍被进程 `
      + `${remainingProcessIds.join('、')} 占用${details}`
  )
}

async function queryUnixListenerProcessIds(
  ports: number[],
  runner: PortReleaseCommandRunner,
  currentProcessId: number
): Promise<number[]> {
  const processIds = new Set<number>()
  for (const port of ports) {
    try {
      const result = await runner('lsof', [
        '-nP',
        `-iTCP:${port}`,
        '-sTCP:LISTEN',
        '-t'
      ])
      for (const processId of parseProcessIds(result.stdout)) {
        if (processId !== currentProcessId) processIds.add(processId)
      }
    } catch (error) {
      if (isEmptyLsofResult(error)) continue
      throw new Error(`查询端口 ${port} 失败：${messageOf(error)}`)
    }
  }
  return [...processIds]
}

function unixReleaseError(
  platform: NodeJS.Platform,
  ports: number[],
  error: unknown
): Error {
  return new Error(
    `${platformName(platform)} 释放端口 ${ports.join('、')} 失败：${messageOf(error)}`
  )
}

async function releaseWindowsPorts(
  ports: number[],
  runner: PortReleaseCommandRunner,
  currentProcessId: number,
  options: ReleaseLoopbackPortOptions,
  processKiller: (pid: number, signal: NodeJS.Signals) => void
): Promise<number[]> {
  let processIds: number[]
  try {
    processIds = await queryWindowsListenerProcessIds(
      ports,
      runner,
      currentProcessId
    )
  } catch (error) {
    throw windowsReleaseError(ports, error)
  }
  if (processIds.length === 0) return []

  const terminationErrors: string[] = []
  for (const processId of processIds) {
    try {
      // Node opens the process handle directly and works in packaged apps where
      // launching taskkill may be denied by Windows application restrictions.
      processKiller(processId, 'SIGKILL')
    } catch (nativeError) {
      try {
        // Keep process-tree termination as a fallback for unusual launchers.
        await runner('taskkill.exe', [
          '/PID',
          String(processId),
          '/T',
          '/F'
        ])
      } catch (taskkillError) {
        // The process may have exited between discovery and termination.
        // Verification below is the source of truth.
        terminationErrors.push(
          `PID ${processId}: ${messageOf(nativeError)}；`
            + `taskkill: ${messageOf(taskkillError)}`
        )
      }
    }
  }

  const { attempts, delayMs } = verificationSettings(options)
  let remainingProcessIds: number[] = []
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      remainingProcessIds = await queryWindowsListenerProcessIds(
        ports,
        runner,
        currentProcessId
      )
      if (remainingProcessIds.length === 0) return processIds
      if (attempt + 1 < attempts && delayMs > 0) await delay(delayMs)
    }
  } catch (error) {
    throw windowsReleaseError(ports, error)
  }

  const details = terminationErrors.length > 0
    ? `；终止进程错误：${terminationErrors.join('；')}`
    : ''
  throw new Error(
    `Windows 释放端口 ${ports.join('、')} 失败：端口仍被进程 `
      + `${remainingProcessIds.join('、')} 占用${details}`
  )
}

async function queryWindowsListenerProcessIds(
  ports: number[],
  runner: PortReleaseCommandRunner,
  currentProcessId: number
): Promise<number[]> {
  // Get-NetTCPConnection can fail with CIM "Access denied" when PowerShell is
  // launched by a packaged Electron app. netstat works for standard users.
  const result = await runner('netstat.exe', ['-ano', '-p', 'tcp'])
  return parseWindowsListenerProcessIds(
    result.stdout,
    ports,
    currentProcessId
  )
}

function windowsReleaseError(ports: number[], error: unknown): Error {
  return new Error(
    `Windows 释放端口 ${ports.join('、')} 失败：${messageOf(error)}`
  )
}

function normalizePorts(ports: readonly number[]): number[] {
  const normalized: number[] = []
  const observed = new Set<number>()
  for (const port of ports) {
    if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`不是有效 TCP 端口：${String(port)}`)
    }
    if (observed.has(port)) continue
    observed.add(port)
    normalized.push(port)
  }
  return normalized
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number
): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : fallback
}

function verificationSettings(options: ReleaseLoopbackPortOptions): {
  attempts: number
  delayMs: number
} {
  return {
    attempts: normalizePositiveInteger(
      options.verificationAttempts,
      DEFAULT_VERIFICATION_ATTEMPTS
    ),
    delayMs: normalizeNonNegativeInteger(
      options.verificationDelayMs,
      DEFAULT_VERIFICATION_DELAY_MS
    )
  }
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number
): number {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : fallback
}

function uniqueProcessIds(output: string, currentProcessId: number): number[] {
  return [...new Set(parseProcessIds(output))]
    .filter(processId => processId !== currentProcessId)
}

function parseWindowsListenerProcessIds(
  output: string,
  ports: number[],
  currentProcessId: number
): number[] {
  const requestedPorts = new Set(ports)
  const processIds = new Set<number>()
  for (const line of output.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u)
    if (columns.length !== 5) continue
    const [protocol, localAddress, , state, processIdText] = columns
    if (protocol.toUpperCase() !== 'TCP') continue
    if (state.toUpperCase() !== 'LISTENING') continue
    const port = Number(localAddress.slice(localAddress.lastIndexOf(':') + 1))
    if (!requestedPorts.has(port)) continue
    const [processId] = parseProcessIds(processIdText)
    if (processId !== currentProcessId) processIds.add(processId)
  }
  return [...processIds]
}

function parseProcessIds(output: string): number[] {
  return output.split(/\s+/u).filter(Boolean).map(token => {
    const processId = Number(token)
    if (!Number.isSafeInteger(processId) || processId <= 0) {
      throw new Error(`端口监听命令返回非法 PID：${token}`)
    }
    return processId
  })
}

async function runCommand(command: string, args: string[]): Promise<CommandResult> {
  const result = await execFileAsync(command, args, {
    encoding: 'utf8',
    windowsHide: true
  })
  return { stdout: String(result.stdout), stderr: String(result.stderr) }
}

function isEmptyLsofResult(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && Number((error as NodeJS.ErrnoException).code) === 1
    && (!('stdout' in error) || String(error.stdout ?? '').trim() === '')
}

function isMissingProcess(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ESRCH'
}

function platformName(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'macOS'
  if (platform === 'linux') return 'Linux'
  return platform
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}
