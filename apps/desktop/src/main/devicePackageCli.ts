import { execFile } from 'node:child_process'

export interface DevicePackageCliConfig {
  unilabExecutable: string
  commandWorkingDirectory: string
  managedWorkingDirectory: string
  backendBaseUrl: string
}

export interface DevicePackageDownloadRequest {
  templateUuid: string
  definitionFqid: string
  artifactDigest: string
}

export interface DevicePackageDownloadResult {
  status: 'package_cached'
  cacheKey: string
  cacheHit: boolean
  distribution: string
  version: string
  namespace: string
  definitionFqid: string
  catalogDigest: string
  configurationSchema: Record<string, unknown>
}

export interface DevicePackageCliCommand {
  command: string
  args: string[]
  cwd: string
  stdin?: string
}

export interface DevicePackageCliCommandResult {
  stdout: string
  stderr: string
}

export type DevicePackageCliCommandRunner = (
  command: DevicePackageCliCommand
) => Promise<DevicePackageCliCommandResult>

/**
 * 通过当前 Electron 选择的 Uni-Lab-OS CLI 下载并校验一个云端设备包。
 *
 * @param config Main 已解析的可执行文件、工作目录和 Backend API 根地址。
 * @param request 从设备详情重新解析出的模板、definition 与 Artifact 摘要。
 * @param commandRunner 可替换的无 shell 进程执行端口。
 * @returns 已进入受管缓存且能驱动配置表单的设备包描述。
 * @throws 输入身份非法、CLI 退出失败或最终 JSON 与请求身份不一致时抛出。
 */
export async function downloadDevicePackageWithCli(
  config: DevicePackageCliConfig,
  request: DevicePackageDownloadRequest,
  commandRunner: DevicePackageCliCommandRunner = runCommand
): Promise<DevicePackageDownloadResult> {
  const command = buildDownloadCommand(config, request)
  const execution = await commandRunner(command)
  return parseDownloadResult(execution.stdout, request)
}

/**
 * 构造禁用 shell 的 argv，确保凭据和用户可编辑脚本都不进入设备包下载命令。
 *
 * @param config 已解析的 Main 配置。
 * @param request 已冻结的下载身份。
 * @returns 可直接交给 execFile 的命令、argv 与 cwd。
 */
export function buildDownloadCommand(
  config: DevicePackageCliConfig,
  request: DevicePackageDownloadRequest
): DevicePackageCliCommand {
  const unilabExecutable = required(config.unilabExecutable, 'unilab 可执行文件')
  const cwd = required(config.commandWorkingDirectory, 'CLI 工作目录')
  const managedWorkingDirectory = required(
    config.managedWorkingDirectory,
    'OS 受管工作目录'
  )
  const backendBaseUrl = normalizeBackendBaseUrl(config.backendBaseUrl)
  assertDownloadRequest(request)
  return {
    command: unilabExecutable,
    cwd,
    args: [
      '--working_dir',
      managedWorkingDirectory,
      '--addr',
      backendBaseUrl,
      'package',
      'download',
      '--template-uuid',
      request.templateUuid,
      '--definition-fqid',
      request.definitionFqid,
      '--artifact-digest',
      request.artifactDigest,
      '--json'
    ]
  }
}

/**
 * 从 CLI 状态日志后的最后一个非空行解析最终 JSON，并校验请求/响应身份闭环。
 *
 * @param stdout CLI 完整标准输出，允许前置非 JSON 状态日志。
 * @param request 本次下载请求身份。
 * @returns 规范化后的受管缓存结果。
 */
export function parseDownloadResult(
  stdout: string,
  request: DevicePackageDownloadRequest
): DevicePackageDownloadResult {
  const finalLine = stdout.split(/\r?\n/u).map((line) => line.trim())
    .filter(Boolean).at(-1)
  if (!finalLine) throw new Error('设备包 CLI 未返回最终 JSON')
  let raw: Record<string, unknown>
  try {
    raw = asRecord(JSON.parse(finalLine))
  } catch (error) {
    throw new Error(`设备包 CLI 最终输出不是合法 JSON：${errorMessage(error)}`)
  }
  if (raw.status !== 'package_cached') {
    throw new Error(`设备包 CLI 返回未知状态：${String(raw.status ?? '')}`)
  }
  const definitionFqid = text(raw.definition_fqid, 'definition_fqid')
  const cacheKey = text(raw.cache_key, 'cache_key')
  if (definitionFqid !== request.definitionFqid) {
    throw new Error(
      `设备包 CLI definition 身份不一致：${definitionFqid} != ${request.definitionFqid}`
    )
  }
  if (!cacheKey.endsWith(`#${request.artifactDigest}`)) {
    throw new Error('设备包 CLI cache_key 未绑定请求 Artifact 摘要')
  }
  if (typeof raw.cache_hit !== 'boolean') {
    throw new Error('设备包 CLI cache_hit 必须是 boolean')
  }
  const configurationSchema = asRecord(raw.configuration_schema)
  if (configurationSchema.type !== 'object') {
    throw new Error('设备包 CLI 未返回 object 类型的配置 Schema')
  }
  return {
    status: 'package_cached',
    cacheKey,
    cacheHit: raw.cache_hit,
    distribution: text(raw.distribution, 'distribution'),
    version: text(raw.version, 'version'),
    namespace: text(raw.namespace, 'namespace'),
    definitionFqid,
    catalogDigest: text(raw.catalog_digest, 'catalog_digest'),
    configurationSchema
  }
}

export interface DeviceGraphStageRequest {
  cacheKey: string
  definitionFqid: string
  instanceId: string
  instanceUuid: string
  adoptExisting: boolean
  graphPath: string
  displayName: string
  configuration: Record<string, unknown>
}

export interface DeviceGraphMutationResult {
  status: 'graph_staged' | 'removed' | 'graph_restored'
  instanceId: string
  instanceUuid: string
  definitionFqid: string
  graphFingerprint: string
  backupPath: string | null
  changed: boolean
}

/**
 * 通过 OS CLI 校验配置并原子新增一个本地设备实例声明。
 *
 * @param config Main 已解析的 Conda CLI 与受管运行目录。
 * @param request 已冻结的包、实例、设备图和非秘密配置。
 * @param commandRunner 可替换的无 shell 进程执行端口。
 * @returns 已写入或幂等命中的设备图变更结果。
 */
export async function stageDeviceWithCli(
  config: DevicePackageCliConfig,
  request: DeviceGraphStageRequest,
  commandRunner: DevicePackageCliCommandRunner = runCommand
): Promise<DeviceGraphMutationResult> {
  return mutateDeviceGraphWithCli(
    'add-device',
    config,
    request,
    commandRunner
  )
}

/**
 * 通过 OS CLI 显式更新既有设备实例配置，不改变稳定实例身份。
 *
 * @param config Main 已解析的 Conda CLI 与受管运行目录。
 * @param request 必须命中既有 ID/UUID/definition 的更新请求。
 * @param commandRunner 可替换的无 shell 进程执行端口。
 * @returns 已更新或幂等命中的设备图变更结果。
 */
export async function updateDeviceWithCli(
  config: DevicePackageCliConfig,
  request: DeviceGraphStageRequest,
  commandRunner: DevicePackageCliCommandRunner = runCommand
): Promise<DeviceGraphMutationResult> {
  return mutateDeviceGraphWithCli(
    'update-device',
    config,
    request,
    commandRunner
  )
}

/**
 * 通过 OS CLI 原子移除一个本地设备实例及其直接连接。
 *
 * @param config Main 已解析的 Conda CLI 与受管运行目录。
 * @param request 当前 Graph 与稳定实例身份。
 * @param commandRunner 可替换的无 shell 进程执行端口。
 * @returns 移除结果及可恢复备份。
 */
export async function removeDeviceWithCli(
  config: DevicePackageCliConfig,
  request: Pick<DeviceGraphStageRequest, 'graphPath' | 'instanceId' | 'instanceUuid'>,
  commandRunner: DevicePackageCliCommandRunner = runCommand
): Promise<DeviceGraphMutationResult> {
  const command = baseCommand(config, [
    'package',
    'remove-device',
    '--graph',
    required(request.graphPath, '设备图路径'),
    '--instance-id',
    required(request.instanceId, '设备实例 ID'),
    '--instance-uuid',
    required(request.instanceUuid, '设备实例 UUID'),
    '--json'
  ])
  const result = await commandRunner(command)
  return parseGraphMutationResult(result.stdout, 'removed')
}

/**
 * 通过 OS CLI 恢复同目录下由设备图接入模块生成的可信备份。
 *
 * @param config Main 已解析的 Conda CLI 与受管运行目录。
 * @param request 当前 Graph 和先前 CLI 返回的备份路径。
 * @param commandRunner 可替换的无 shell 进程执行端口。
 * @returns 恢复后的设备图指纹与恢复前备份。
 */
export async function restoreDeviceGraphWithCli(
  config: DevicePackageCliConfig,
  request: { graphPath: string; backupPath: string },
  commandRunner: DevicePackageCliCommandRunner = runCommand
): Promise<DeviceGraphMutationResult> {
  const command = baseCommand(config, [
    'package',
    'restore-graph',
    '--graph',
    required(request.graphPath, '设备图路径'),
    '--backup',
    required(request.backupPath, '设备图备份路径'),
    '--json'
  ])
  const result = await commandRunner(command)
  return parseGraphMutationResult(result.stdout, 'graph_restored')
}

/**
 * 执行新增或更新共享的封闭 argv 与 stdin 设备图变更合同。
 *
 * @param action 只允许新增或显式更新；遗留接管只附着于新增动作。
 * @param config Main 已验证的 CLI、受管目录和固定 Backend 配置。
 * @param request 已冻结的包、实例、接管意图、设备图和配置。
 * @param commandRunner 可替换的无 shell 子进程执行端口。
 * @returns 已复核实例身份的设备图原子变更结果。
 */
async function mutateDeviceGraphWithCli(
  action: 'add-device' | 'update-device',
  config: DevicePackageCliConfig,
  request: DeviceGraphStageRequest,
  commandRunner: DevicePackageCliCommandRunner
): Promise<DeviceGraphMutationResult> {
  const command = baseCommand(config, [
    'package',
    action,
    '--cache-key',
    required(request.cacheKey, '设备包 cache_key'),
    '--definition-fqid',
    required(request.definitionFqid, 'definition FQID'),
    '--instance-id',
    required(request.instanceId, '设备实例 ID'),
    '--instance-uuid',
    required(request.instanceUuid, '设备实例 UUID'),
    ...(action === 'add-device' && request.adoptExisting
      ? ['--adopt-existing']
      : []),
    '--graph',
    required(request.graphPath, '设备图路径'),
    '--config-stdin',
    '--json'
  ])
  command.stdin = JSON.stringify({
    display_name: required(request.displayName, '设备显示名称'),
    configuration: request.configuration
  })
  const result = await commandRunner(command)
  const parsed = parseGraphMutationResult(result.stdout, 'graph_staged')
  if (
    parsed.instanceId !== request.instanceId
    || parsed.instanceUuid !== request.instanceUuid
    || parsed.definitionFqid !== request.definitionFqid
  ) {
    throw new Error('设备图 CLI 返回的实例身份与请求不一致')
  }
  return parsed
}

/** 构造复用当前受管 working_dir 的无 shell package 命令。 */
function baseCommand(
  config: DevicePackageCliConfig,
  args: string[]
): DevicePackageCliCommand {
  return {
    command: required(config.unilabExecutable, 'unilab 可执行文件'),
    cwd: required(config.commandWorkingDirectory, 'CLI 工作目录'),
    args: [
      '--working_dir',
      required(config.managedWorkingDirectory, 'OS 受管工作目录'),
      ...args
    ]
  }
}

/** 从 CLI 最后一行解析并严格校验设备图变更结果。 */
export function parseGraphMutationResult(
  stdout: string,
  expectedStatus: DeviceGraphMutationResult['status']
): DeviceGraphMutationResult {
  const raw = parseFinalJson(stdout)
  if (raw.status !== expectedStatus) {
    throw new Error(`设备图 CLI 返回未知状态：${String(raw.status ?? '')}`)
  }
  const backupPath = raw.backup_path
  if (backupPath !== null && typeof backupPath !== 'string') {
    throw new Error('设备图 CLI backup_path 必须是 string 或 null')
  }
  if (typeof raw.changed !== 'boolean') {
    throw new Error('设备图 CLI changed 必须是 boolean')
  }
  const graphFingerprint = text(raw.graph_fingerprint, 'graph_fingerprint')
  if (!/^sha256:[0-9a-f]{64}$/u.test(graphFingerprint)) {
    throw new Error('设备图 CLI graph_fingerprint 无效')
  }
  return {
    status: expectedStatus,
    instanceId: optionalText(raw.instance_id),
    instanceUuid: optionalText(raw.instance_uuid),
    definitionFqid: optionalText(raw.definition_fqid),
    graphFingerprint,
    backupPath,
    changed: raw.changed
  }
}

/**
 * 使用 Node execFile 执行 CLI，明确关闭 shell 并限制运行时间与输出体积。
 *
 * @param command 已校验的无 shell 命令规范。
 * @returns CLI 标准输出和标准错误；非零退出由 execFile 原样抛出。
 */
export async function runCommand(
  command: DevicePackageCliCommand
): Promise<DevicePackageCliCommandResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(command.command, command.args, {
      cwd: command.cwd,
      encoding: 'utf8',
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      timeout: 5 * 60 * 1000,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(
          `${error.message}${stderr ? `\n${String(stderr).trim()}` : ''}`
        ))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
    if (command.stdin !== undefined) child.stdin?.end(command.stdin)
  })
}

/** 校验模板 UUID、definition FQID 和小写 sha256 摘要。 */
function assertDownloadRequest(request: DevicePackageDownloadRequest): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
    .test(request.templateUuid)) {
    throw new Error(`设备模板 UUID 无效：${request.templateUuid}`)
  }
  if (!/^community\.[a-z_][a-z0-9_]*\.[A-Za-z0-9_]+$/u
    .test(request.definitionFqid)) {
    throw new Error(`设备 definition FQID 无效：${request.definitionFqid}`)
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(request.artifactDigest)) {
    throw new Error('设备包 Artifact 摘要必须是小写 sha256')
  }
}

/** 校验 Backend API 根地址，拒绝凭据、query 与 fragment 进入 argv。 */
function normalizeBackendBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(required(value, 'Backend API 根地址'))
  } catch (error) {
    throw new Error(`Backend API 根地址无效：${errorMessage(error)}`)
  }
  if (
    !['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || url.search
    || url.hash
  ) {
    throw new Error('Backend API 根地址必须是无凭据、query 和 fragment 的 HTTP(S) URL')
  }
  return url.toString().replace(/\/$/u, '')
}

/** 读取必填字符串并去除首尾空白。 */
function required(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(`${label}不能为空`)
  return normalized
}

/** 从 CLI JSON 读取非空字符串字段。 */
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`设备包 CLI 缺少 ${field}`)
  }
  return value
}

/** 把 JSON unknown 安全收窄为普通对象。 */
function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('设备包 CLI 最终 JSON 必须是 object')
  }
  return value as Record<string, unknown>
}

/** 从允许前置状态日志的 CLI stdout 解析最后一个 JSON object。 */
export function parseFinalJson(stdout: string): Record<string, unknown> {
  const finalLine = stdout.split(/\r?\n/u).map((line) => line.trim())
    .filter(Boolean).at(-1)
  if (!finalLine) throw new Error('设备包 CLI 未返回最终 JSON')
  try {
    return asRecord(JSON.parse(finalLine))
  } catch (error) {
    throw new Error(`设备包 CLI 最终输出不是合法 JSON：${errorMessage(error)}`)
  }
}

/** 把可选 CLI 字段收敛为空字符串或非空字符串。 */
function optionalText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** 把未知异常规范化为可展示正文。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
