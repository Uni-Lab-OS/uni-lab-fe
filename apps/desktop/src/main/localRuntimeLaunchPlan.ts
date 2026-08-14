/**
 * 把用户路径配置解析为可审计、可测试且不产生副作用的本地子进程启动计划。
 */
import type { LocalRuntimeLaunchConfig } from '../shared/localRuntime'
import {
  resolveRuntimeConfig,
  resolveSimulatorConfig,
  type ResolvedRuntimeConfig,
  type ResolvedSimulatorConfig
} from './localRuntimeLaunchConfig'
import {
  activatedCondaEnvironment,
  mergeCustomEdgeEnvironment,
  runtimeEnvironment
} from './localRuntimeEnvironment'
import {
  LOCAL_RUNTIME_HOST,
  LOCAL_RUNTIME_PORTS,
  type LocalRuntimeLaunchPlan,
  type LocalRuntimePorts,
  type LocalRuntimeSpawnSpec,
  type LocalSimulatorLaunchPlan
} from './localRuntimeLaunchContract'
import type { LocalRuntimePortRequirement } from './localRuntimePorts'

export {
  LOCAL_RUNTIME_HOST,
  LOCAL_RUNTIME_PORTS,
  normalizeLocalRuntimePorts
} from './localRuntimeLaunchContract'
export type {
  ActiveLocalDeviceProvisioningRuntime,
  LocalDeviceProvisioningRuntime,
  LocalRuntimeLaunchPlan,
  LocalRuntimePorts,
  LocalRuntimeSpawnSpec,
  LocalSimulatorLaunchPlan
} from './localRuntimeLaunchContract'

// 启动器为每次边缘执行（Edge）子进程分配的 ROS 2 域编号闭区间。
const EDGE_ROS_DOMAIN_ID_MIN = 2
const EDGE_ROS_DOMAIN_ID_COUNT = 98

/**
 * 解析领域侧边缘执行（Edge）的可执行启动计划。
 *
 * @param config 用户选择的本地运行路径。
 * @param platform 当前桌面平台，用于解析 Conda 可执行文件。
 * @param ports 当前启动环境的端口事实。
 * @returns Edge 命令、端口要求、运行目录和设备目录就绪条件。
 * @throws 路径、端口、可执行文件或自定义命令不合法时抛出中文诊断。
 * @safety 只解析并校验启动事实，不启动进程；显式配置错误不会降级为空设备。
 */
export async function resolveLocalRuntimeLaunchPlan(
  config: LocalRuntimeLaunchConfig,
  platform: NodeJS.Platform = process.platform,
  ports: LocalRuntimePorts = LOCAL_RUNTIME_PORTS
): Promise<LocalRuntimeLaunchPlan> {
  const resolvedConfig = await resolveRuntimeConfig(config, platform, ports)
  return {
    runtimeDirectory: resolvedConfig.runtimeDirectory,
    edge: edgeSpec(resolvedConfig),
    ports: resolvedConfig.ports,
    requiredPorts: edgeRequiredPorts(resolvedConfig.ports),
    deviceCatalogRequirement: resolvedConfig.szlabProjectPath
      ? 'domain_actions'
      : 'catalog',
    deviceProvisioning: {
      graphPath: resolvedConfig.graphPath,
      unilabExecutable: resolvedConfig.unilabExecutable,
      commandWorkingDirectory: resolvedConfig.szlabProjectPath
        || resolvedConfig.osProjectPath,
      managedWorkingDirectory: resolvedConfig.runtimeDirectory,
      localConfigPath: resolvedConfig.localConfigPath,
      localApiUrl: localRuntimeEdgeHttpUrl(resolvedConfig.ports.edgeHttp)
    }
  }
}

/** 生成当前 Edge HTTP 根地址，不向设备接入编排器暴露端口拼接细节。 */
function localRuntimeEdgeHttpUrl(port: number): string {
  return `http://${LOCAL_RUNTIME_HOST}:${port}`
}

/**
 * 解析 PLC-Sim 的可执行启动计划。
 *
 * @param config 用户选择的 Conda 与 PLC-Sim 路径。
 * @param platform 当前桌面平台，用于解析 Python 可执行文件。
 * @param ports 当前启动环境的端口事实。
 * @returns PLC-Sim 命令和启动前端口要求。
 * @throws Conda、PLC-Sim、端口或可执行文件不合法时抛出中文诊断。
 * @safety 只读取项目结构并生成命令，不启动模拟器或连接设备。
 */
export async function resolveLocalSimulatorLaunchPlan(
  config: LocalRuntimeLaunchConfig,
  platform: NodeJS.Platform = process.platform,
  ports: LocalRuntimePorts = LOCAL_RUNTIME_PORTS
): Promise<LocalSimulatorLaunchPlan> {
  const resolvedConfig = await resolveSimulatorConfig(config, platform, ports)
  return {
    simulator: simulatorSpec(resolvedConfig),
    ports: resolvedConfig.ports,
    requiredPorts: simulatorRequiredPorts(resolvedConfig.ports)
  }
}

/**
 * 声明启动 PLC-Sim 前必须释放的端口。
 *
 * @param ports 已规范化的本地启动端口事实。
 * @returns PLC-Sim Web GUI 与 OPC UA 端口要求；Edge 可独立保持运行。
 * @throws 不抛出异常。
 * @safety 只构造端口要求，不终止监听进程。
 */
function simulatorRequiredPorts(
  ports: LocalRuntimePorts
): LocalRuntimePortRequirement[] {
  return [
    { port: ports.simulatorGui, label: 'PLC-Sim Web GUI' },
    { port: ports.simulatorOpcUa, label: 'PLC-Sim OPC UA' }
  ]
}

/**
 * 声明直接启动边缘执行（Edge）前必须释放的端口。
 *
 * @param ports 已规范化的本地启动端口事实。
 * @returns Edge HTTP 与 HostLink 端口要求。
 * @throws 不抛出异常。
 * @safety 只构造端口要求，不终止监听进程。
 */
function edgeRequiredPorts(
  ports: LocalRuntimePorts
): LocalRuntimePortRequirement[] {
  return [
    { port: ports.edgeHttp, label: '领域侧 Edge HTTP' },
    { port: ports.hostLink, label: 'Edge HostLink' }
  ]
}

/**
 * 构造 PLC-Sim Web GUI 子进程规范。
 *
 * @param config 已校验的 Conda、工作目录和端口配置。
 * @returns 禁用 shell 的 Python 模块启动命令。
 * @throws 不抛出异常。
 * @safety 只构造 argv 和环境，不启动子进程。
 */
function simulatorSpec(config: ResolvedSimulatorConfig): LocalRuntimeSpawnSpec {
  return {
    command: config.pythonExecutable,
    args: [
      '-m',
      'gui.backend',
      '--host',
      LOCAL_RUNTIME_HOST,
      '--port',
      String(config.ports.simulatorGui)
    ],
    cwd: config.workingDirectory,
    env: {
      ...activatedCondaEnvironment(config.environmentPath, config.platform),
      PYTHONUNBUFFERED: '1'
    }
  }
}

/**
 * 构造一次边缘执行（Edge）子进程规范。
 *
 * @param config 已校验且解析完成的本地运行配置。
 * @returns 命令、参数、工作目录和本次随机 ROS 域编号。
 * @throws 不抛出异常；所有输入已由解析阶段校验。
 * @safety 仅构造子进程参数，不启动进程或连接设备。
 */
function edgeSpec(config: ResolvedRuntimeConfig): LocalRuntimeSpawnSpec {
  const generatedArgs = [
    ...(config.szlabProjectPath
      ? ['--workspace', config.szlabProjectPath]
      : []),
    ...(config.graphPath ? ['--graph', config.graphPath] : []),
    '--config',
    config.localConfigPath,
    '--working_dir',
    config.runtimeDirectory,
    '--backend',
    'ros',
    '--app_bridges',
    'fastapi',
    '--port',
    String(config.ports.edgeHttp),
    '--disable_browser',
    '--visual',
    'rviz',
    '--skip_env_check'
  ]
  const customEnvironment = config.customEdgeCommand?.environment ?? []
  const baseEnvironment = runtimeEnvironment(
    config.environmentPath,
    config.platform,
    config.osProjectPath,
    config.szlabProjectPath
  )
  const userExtendedEnvironment = mergeCustomEdgeEnvironment(
    baseEnvironment,
    customEnvironment,
    config.platform
  )
  return {
    command: config.customEdgeCommand?.command ?? config.unilabExecutable,
    args: config.customEdgeCommand?.args ?? generatedArgs,
    cwd: config.customEdgeCommand?.workingDirectory
      ?? (config.szlabProjectPath || config.osProjectPath),
    env: {
      ...userExtendedEnvironment,
      UNILABOS_OBSERVABILITYCONFIG_ENABLED: 'true',
      UNILABOS_OBSERVABILITYCONFIG_PROJECT_NAME: 'uni-lab-electron',
      UNILABOS_OTEL_ENABLED:
        userExtendedEnvironment['UNILABOS_OTEL_ENABLED'] ?? 'true',
      OTEL_EXPORTER_OTLP_ENDPOINT:
        userExtendedEnvironment['OTEL_EXPORTER_OTLP_ENDPOINT']
          ?? 'http://127.0.0.1:4318',
      OTEL_EXPORTER_OTLP_PROTOCOL:
        userExtendedEnvironment['OTEL_EXPORTER_OTLP_PROTOCOL']
          ?? 'http/protobuf',
      OTEL_EXPORTER_OTLP_INSECURE:
        userExtendedEnvironment['OTEL_EXPORTER_OTLP_INSECURE'] ?? 'true',
      OTEL_SERVICE_NAME:
        userExtendedEnvironment['OTEL_SERVICE_NAME'] ?? 'uni-lab-edge-local',
      OTEL_DEPLOYMENT_ENVIRONMENT:
        userExtendedEnvironment['OTEL_DEPLOYMENT_ENVIRONMENT']
          ?? 'development',
      UNILABOS_HOSTLINKCONFIG_PORT: String(config.ports.hostLink),
      ROS_DOMAIN_ID: randomEdgeRosDomainId()
    }
  }
}

/**
 * 为一次边缘执行（Edge）启动生成 2 至 99 的 ROS 域编号。
 *
 * @returns 可直接写入 ROS_DOMAIN_ID 的无前导零十进制字符串。
 * @throws 不抛出异常。
 * @safety 每次启动重新随机，降低同机 DDS 域冲突概率。
 */
function randomEdgeRosDomainId(): string {
  const domainId = Math.floor(Math.random() * EDGE_ROS_DOMAIN_ID_COUNT)
    + EDGE_ROS_DOMAIN_ID_MIN
  return String(domainId)
}
