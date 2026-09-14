import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import {
  readGitRevision,
  resolveExpectedF05OsRevision,
  type GitRevisionEvidence
} from './f05-os-revision'
import {
  writeF05Evidence,
  type NativeLogEvidence
} from './f05-material-source-public-api'
import {
  runReservationRelease,
  runReservationReserve
} from './f05-material-source-reservations'

export { readGitRevision } from './f05-os-revision'
export {
  joinNativeLogs,
  postPublicEnvelope,
  readPublicEnvelope,
  requestJsonInBrowser,
  UUID_PATTERN,
  writeF05Evidence,
  type BrowserJsonResult,
  type NativeLogEvidence
} from './f05-material-source-public-api'

// 以下 UUID 分别固定真实夹具的工作流（Workflow）、物料来源（MaterialSource）
// 节点、挂载物料和目标库位（Site）身份。
export const F05_WORKFLOW_UUID = '65000000-0000-4000-8000-0000000002b0'
export const F05_SOURCE_NODE_UUID = '66000000-0000-4000-8000-0000000002b0'
export const F05_MOUNT_MATERIAL_UUID = '97539b08-24de-5003-8b2e-9eb6e983c68a'
export const F05_SITE_UUID = '1962ab7c-b006-5e44-a1bd-9b1fde81d529'
export interface F05MaterialSourceRealOs {
  url: string
  workflowUuid: string
  sourceNodeUuid: string
  mountMaterialUuid: string
  siteUuid: string
  osRevision: GitRevisionEvidence
  command: readonly string[]
  workingDirectory: string
  logs: () => string
  nativeLogs: () => readonly NativeLogEvidence[]
  reserveWorkflowMaterial: (
    workflowTaskUuid: string,
    materialUuid: string
  ) => { workflow_id: string; reserved_nodes: string[] }
  releaseWorkflowReservation: (
    workflowTaskUuid: string
  ) => {
    workflow_id: string
    released_nodes: string[]
    released_bindings: string[]
  }
  stop: () => Promise<void>
}

/**
 * 收集真实 native `unilab` 子进程的标准输出与错误输出。
 *
 * 参数：构造时无参数；`append` 接受一个进程输出块。
 * 返回：`text` 返回目前全部日志文本，`append` 无返回值。
 * 异常：无；无法识别的输出块按字符串转换保存。
 */
class ProcessOutputCollector {
  private output = ''

  /** 构造空日志收集器；参数无，返回新实例，异常无。 */
  constructor() {
    this.append = this.append.bind(this)
  }

  /**
   * 追加一个 native 子进程输出块。
   *
   * 参数：`chunk` 是 stdout/stderr 交付的原始输出块。
   * 返回：无。异常：无。
   */
  append(chunk: unknown): void {
    this.output += String(chunk)
  }

  /**
   * 返回当前完整 native 子进程日志。
   *
   * 参数：无。返回：按到达顺序拼接的日志文本。异常：无。
   */
  text(): string {
    return this.output
  }
}

/**
 * 启动 F05 浏览器验收使用的真实 OS 本地调度运行时。
 *
 * 参数：无；可用 `UNILAB_AUTHORING_OS_ROOT` 覆盖产品 OS 根目录，或用
 * `UNILAB_OS_CLI` 覆盖 native CLI；仅显式完整
 * `UNILAB_AUTHORING_OS_REVISION` 可覆盖默认审定修订。
 * 返回：包含公共 HTTP 地址、领域身份、命令、修订和清理能力的运行时证据。
 * 异常：修订覆盖非法、工作树非干净或 HEAD 不精确匹配、夹具缺失、CLI 退出、
 * 公共就绪接口未在期限内可用时抛出；已创建的临时目录会被清理。
 */
export async function startF05MaterialSourceRealOs(): Promise<F05MaterialSourceRealOs> {
  const osRepository = resolve(
    process.env.UNILAB_AUTHORING_OS_ROOT ||
      '/home/changjunhan/Uni-Lab-Core/.worktrees/unilabos-f05-4-c14-material-source-execution-responsibility'
  )
  const cli = resolve(
    process.env.UNILAB_OS_CLI ||
      '/home/changjunhan/.micromamba/envs/unilab/bin/unilab'
  )
  const fixtureSource = resolve(
    process.cwd(),
    'e2e/fixtures/m2b-native-workspace'
  )
  const f05WorkflowSource = resolve(
    process.cwd(),
    'e2e/fixtures/f05-material-source-workflow.py.fixture'
  )
  assertRequiredPaths([osRepository, cli, fixtureSource, f05WorkflowSource])
  // ``expectedOsRevision`` 是本轮唯一获准启动的 OS 候选提交身份。
  const expectedOsRevision = resolveExpectedF05OsRevision()
  const osRevision = readGitRevision(osRepository)
  if (osRevision.sha !== expectedOsRevision || osRevision.dirty) {
    throw new Error(
      `F05 真实 OS 修订不匹配：期望 ${expectedOsRevision}，实际 ${JSON.stringify(osRevision)}`
    )
  }

  const directory = mkdtempSync(join(tmpdir(), 'unilab-f05-real-os-'))
  const workspaceDirectory = join(directory, 'workspace')
  const workingDirectory = join(directory, 'unilabos_data')
  cpSync(fixtureSource, workspaceDirectory, {
    recursive: true,
    filter: shouldCopyFixtureEntry
  })
  writeFileSync(
    join(
      workspaceDirectory,
      'm2b_native_e2e',
      'workflows',
      'material_source.py'
    ),
    readFileSync(f05WorkflowSource, 'utf8'),
    'utf8'
  )
  const python = resolve(cli, '..', 'python')
  const reservationControlScript = join(
    workspaceDirectory,
    'inventory_reservation_control.py'
  )
  assertRequiredPaths([python, reservationControlScript])
  const pythonPath = `${workspaceDirectory}:${osRepository}`
  const port = await availablePort()
  const url = `http://127.0.0.1:${port}`
  const args = [
    '--workspace', workspaceDirectory,
    '--graph', join(workspaceDirectory, 'graph.json'),
    '--config', join(workspaceDirectory, 'local_config.py'),
    '--working_dir', workingDirectory,
    '--preserve_runtime_databases',
    '--backend', 'ros',
    '--app_bridges', 'fastapi',
    '--port', String(port),
    '--disable_browser',
    '--external_devices_only'
  ]
  const output = new ProcessOutputCollector()
  const child = spawn(cli, args, {
    cwd: osRepository,
    env: {
      ...process.env,
      PYTHONPATH: `${workspaceDirectory}:${osRepository}${
        process.env.PYTHONPATH ? `:${process.env.PYTHONPATH}` : ''
      }`,
      PYTHONUNBUFFERED: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', output.append)
  child.stderr?.on('data', output.append)

  try {
    await waitUntilPublicContractsReady(url, child, output)
  } catch (error) {
    // ``publicResponses`` 保存失败时仍可读取的公共 HTTP 状态与响应体，禁止用
    // SQLite 或私有库存接口补齐证据。
    const publicResponses = await Promise.all([
      capturePublicResponse(`${url}/api/v1/materials/graph`),
      capturePublicResponse(
        `${url}/api/v1/workflows/${F05_WORKFLOW_UUID}/authoring`
      )
    ])
    writeF05Evidence({
      outcome: 'blocked',
      error: String(error),
      osRevision,
      nativeCommand: [cli, ...args],
      publicResponses,
      nativeStdout: output.text(),
      nativeLogs: readNativeLogs(workingDirectory)
    })
    await stopChild(child)
    rmSync(directory, { recursive: true, force: true })
    throw error
  }

  /**
   * 为进程外测试持有者预留指定具体物料。
   *
   * @param workflowTaskUuid 测试持有者身份。
   * @param materialUuid 待预留的具体物料 UUID。
   * @returns 生产库存服务的预留结果。
   * @throws 子进程或库存权威失败时原样传播。
   */
  function reserveWorkflowMaterial(
    workflowTaskUuid: string,
    materialUuid: string
  ): { workflow_id: string; reserved_nodes: string[] } {
    return runReservationReserve({
      python,
      script: reservationControlScript,
      inventoryDatabase: join(workingDirectory, 'inventory.db'),
      workflowTaskUuid,
      workflowNodeUuid: F05_SOURCE_NODE_UUID,
      materialUuid,
      pythonPath
    })
  }

  /**
   * 释放进程外测试持有者的全部活跃预留。
   *
   * @param workflowTaskUuid 测试持有者身份。
   * @returns 生产库存服务的释放结果。
   * @throws 子进程或库存权威失败时原样传播。
   */
  function releaseWorkflowReservation(
    workflowTaskUuid: string
  ): {
    workflow_id: string
    released_nodes: string[]
    released_bindings: string[]
  } {
    return runReservationRelease({
      python,
      script: reservationControlScript,
      inventoryDatabase: join(workingDirectory, 'inventory.db'),
      workflowTaskUuid,
      pythonPath
    })
  }

  return {
    url,
    workflowUuid: F05_WORKFLOW_UUID,
    sourceNodeUuid: F05_SOURCE_NODE_UUID,
    mountMaterialUuid: F05_MOUNT_MATERIAL_UUID,
    siteUuid: F05_SITE_UUID,
    osRevision,
    command: [cli, ...args],
    workingDirectory,
    logs: output.text.bind(output),
    nativeLogs: readNativeLogs.bind(undefined, workingDirectory),
    reserveWorkflowMaterial,
    releaseWorkflowReservation,
    stop: createRuntimeStop(child, directory)
  }
}

/**
 * 捕获一个公共 HTTP 响应作为失败证据。
 *
 * 参数：`url` 是公共接口地址。返回：URL、HTTP 状态和 JSON 响应体；网络失败时
 * 返回错误文本。异常：不向外抛出，避免证据采集覆盖原始启动失败。
 */
async function capturePublicResponse(url: string): Promise<unknown> {
  try {
    const response = await fetch(url)
    return { url, status: response.status, body: await response.json() }
  } catch (error) {
    return { url, captureError: String(error) }
  }
}

/**
 * 校验真实 OS、CLI 与工作区夹具路径全部存在。
 *
 * 参数：`paths` 是本轮运行不可缺少的绝对路径集合。
 * 返回：无。异常：任一路径缺失时抛出带缺失路径的错误。
 */
function assertRequiredPaths(paths: readonly string[]): void {
  for (const path of paths) {
    if (!existsSync(path)) {
      throw new Error(`F05 真实 OS 夹具路径不存在：${path}`)
    }
  }
}

/**
 * 决定复制工作区夹具时是否保留当前文件。
 *
 * 参数：`source` 是 `cpSync` 正在访问的源路径。
 * 返回：Python 缓存目录之外返回 `true`。异常：无。
 */
function shouldCopyFixtureEntry(source: string): boolean {
  return !source.includes('__pycache__')
}

/**
 * 等待真实 OS 同时暴露公共物料图和工作流创作聚合。
 *
 * 参数：`url` 是公共 HTTP 根；`child` 是 native 进程；`output` 提供诊断日志。
 * 返回：两个公共接口就绪且候选包含固定物料来源节点后返回。
 * 异常：进程提前退出或 120 秒内未就绪时抛出；禁止查询私有库存接口。
 */
async function waitUntilPublicContractsReady(
  url: string,
  child: ChildProcess,
  output: ProcessOutputCollector
): Promise<void> {
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `真实 native unilab 已退出（${child.exitCode}）\n${output.text()}`
      )
    }
    if (output.text().includes('挂载 Backend Workflow 合同失败')) {
      throw new Error(
        `真实 OS 无法挂载工作流（Workflow）公共合同\n${output.text()}`
      )
    }
    try {
      const [materialGraphResponse, authoringResponse] = await Promise.all([
        fetch(`${url}/api/v1/materials/graph`),
        fetch(`${url}/api/v1/workflows/${F05_WORKFLOW_UUID}/authoring`)
      ])
      if (materialGraphResponse.ok && authoringResponse.ok) {
        const materialGraphEnvelope = await materialGraphResponse.json() as {
          code?: number
          data?: unknown
        }
        const authoringEnvelope = await authoringResponse.json() as {
          code?: number
          data?: {
            candidate?: { graph?: { nodes?: Array<{ uuid?: string }> } } | null
            applied_graph?: { nodes?: Array<{ uuid?: string }> }
          }
        }
        if (
          materialGraphEnvelope.code === 0 && authoringEnvelope.code === 0 &&
          !JSON.stringify(materialGraphEnvelope.data).includes('"nodes":[]') &&
          JSON.stringify(authoringEnvelope.data).includes(F05_SOURCE_NODE_UUID)
        ) return
      }
    } catch {
      // native CLI 与包监视器仍在启动；下一轮只重试相同两个公共接口。
    }
    await delay(250)
  }
  throw new Error(
    `真实 native unilab 未暴露 F05 公共合同\n${output.text()}`
  )
}

/**
 * 读取 OS 工作目录内已经落盘的 native 日志证据。
 *
 * 参数：`workingDirectory` 是本轮隔离的 OS 工作目录。
 * 返回：按文件名排序的日志名称与内容；日志目录不存在时返回空集合。
 * 异常：日志目录存在但无法读取时原样抛出。
 */
function readNativeLogs(workingDirectory: string): readonly NativeLogEvidence[] {
  const logsDirectory = join(workingDirectory, 'logs')
  if (!existsSync(logsDirectory)) return []
  const names: string[] = []
  for (const name of readdirSync(logsDirectory)) {
    if (name.endsWith('.log')) names.push(name)
  }
  names.sort()
  const entries: NativeLogEvidence[] = []
  for (const name of names) {
    entries.push({
      name,
      content: readFileSync(join(logsDirectory, name), 'utf8')
    })
  }
  return entries
}

/**
 * 分配当前主机可监听的临时 TCP 端口。
 *
 * 参数：无。返回：内核分配的端口号。
 * 异常：监听失败、地址形状非法或关闭失败时抛出。
 */
async function availablePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    await once(server, 'close')
    throw new Error('无法分配真实 native unilab 端口')
  }
  const port = address.port
  server.close()
  await once(server, 'close')
  return port
}

/**
 * 创建只能调用一次语义的真实 OS 清理函数。
 *
 * 参数：`child` 是 native 进程，`directory` 是隔离临时目录。
 * 返回：异步清理函数；清理函数自身返回无。
 * 异常：进程终止异常原样传播，但目录仍尝试删除。
 */
function createRuntimeStop(
  child: ChildProcess,
  directory: string
): () => Promise<void> {
  /**
   * 停止 native 进程并删除本轮临时目录。
   *
   * 参数：无。返回：无。异常：进程终止异常原样传播。
   */
  async function stopRuntime(): Promise<void> {
    try {
      await stopChild(child)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  return stopRuntime
}

/**
 * 温和停止 native 子进程，超时后再强制终止。
 *
 * 参数：`child` 是待停止的真实 OS 进程。
 * 返回：进程已退出或已发送强制终止后返回无。
 * 异常：信号发送失败时原样抛出。
 */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGINT')
  const timeoutMarker = Symbol('stop-timeout')
  const outcome = await Promise.race([
    once(child, 'exit'),
    delay(5_000, timeoutMarker)
  ])
  if (outcome === timeoutMarker && child.exitCode === null) {
    child.kill('SIGKILL')
    await once(child, 'exit')
  }
}
