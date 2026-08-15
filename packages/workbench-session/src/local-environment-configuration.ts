import { readFile, rename, rm, writeFile } from 'node:fs/promises'

import { WorkbenchLaunchError } from './launch-error'

export type PersistedWorkbenchRuntimeMode = 'normal' | 'dry-run'
export type PersistedPlcHandshakeProfile = 'szlab' | 'xuse'
export type PersistedWorkbenchDomainMode = 'local' | 'backend'

export interface LocalEnvironmentConfiguration {
  graphPath: string | null
  externalDevicesOnly: boolean | null
  plcSimulatorProjectPath: string | null
  plcVariableTablePath: string | null
  plcHandshakeProfile: PersistedPlcHandshakeProfile | null
  runtimeMode: PersistedWorkbenchRuntimeMode | null
  domainMode: PersistedWorkbenchDomainMode | null
  backendUrl: string | null
  schedulerUrl: string | null
}

export interface WritableLocalEnvironmentConfiguration {
  graphPath: string
  externalDevicesOnly: boolean
  plcSimulatorProjectPath: string
  plcVariableTablePath: string
  plcHandshakeProfile: PersistedPlcHandshakeProfile
  runtimeMode: PersistedWorkbenchRuntimeMode
  domainMode: PersistedWorkbenchDomainMode
  backendUrl: string | null
  schedulerUrl: string | null
}

/** Read the optional managed-local configuration and reject corrupt state. */
export async function readLocalEnvironmentConfiguration(
  configurationPath: string
): Promise<LocalEnvironmentConfiguration> {
  let source: string
  try {
    source = await readFile(configurationPath, 'utf8')
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ENOENT') {
      return {
        graphPath: null,
        externalDevicesOnly: null,
        plcSimulatorProjectPath: null,
        plcVariableTablePath: null,
        plcHandshakeProfile: null,
        runtimeMode: null,
        domainMode: null,
        backendUrl: null,
        schedulerUrl: null
      }
    }
    throw invalidLocalEnvironmentConfiguration(
      configurationPath,
      '本地环境配置无法读取'
    )
  }
  let content: unknown
  try {
    content = JSON.parse(source) as unknown
  } catch {
    throw invalidLocalEnvironmentConfiguration(
      configurationPath,
      '本地环境配置不是有效 JSON'
    )
  }
  if (!isRecord(content) || content['schemaVersion'] !== 1) {
    throw invalidLocalEnvironmentConfiguration(
      configurationPath,
      '本地环境配置 schemaVersion 无效'
    )
  }
  const graphPath = optionalString(
    content['graphPath'],
    configurationPath,
    'graphPath'
  )
  const plcSimulatorProjectPath = optionalString(
    content['plcSimulatorProjectPath'],
    configurationPath,
    'plcSimulatorProjectPath'
  )
  const plcVariableTablePath = optionalString(
    content['plcVariableTablePath'],
    configurationPath,
    'plcVariableTablePath'
  )
  return {
    graphPath,
    externalDevicesOnly: optionalBoolean(
      content['externalDevicesOnly'],
      configurationPath,
      'externalDevicesOnly'
    ),
    plcSimulatorProjectPath,
    plcVariableTablePath,
    plcHandshakeProfile: persistedPlcHandshakeProfile(
      content['plcHandshakeProfile'],
      configurationPath
    ),
    runtimeMode: persistedRuntimeMode(content['runtimeMode'], configurationPath),
    domainMode: persistedDomainMode(content['domainMode'], configurationPath),
    backendUrl: optionalString(
      content['backendUrl'],
      configurationPath,
      'backendUrl'
    ),
    schedulerUrl: optionalString(
      content['schedulerUrl'],
      configurationPath,
      'schedulerUrl'
    )
  }
}

function optionalBoolean(
  value: unknown,
  configurationPath: string,
  field: string
): boolean | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value
  throw invalidLocalEnvironmentConfiguration(
    configurationPath,
    `本地环境配置 ${field} 无效`
  )
}

/** Atomically replace the managed-local configuration after validation. */
export async function writeLocalEnvironmentConfigurationFile(
  configurationPath: string,
  configuration: WritableLocalEnvironmentConfiguration
): Promise<void> {
  const temporaryPath = `${configurationPath}.${process.pid}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify({
      schemaVersion: 1,
      ...configuration
    }, null, 2)}\n`, { mode: 0o600 })
    await rename(temporaryPath, configurationPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function optionalString(
  value: unknown,
  configurationPath: string,
  field: string
): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  throw invalidLocalEnvironmentConfiguration(
    configurationPath,
    `本地环境配置 ${field} 无效`
  )
}

function persistedRuntimeMode(
  value: unknown,
  configurationPath: string
): PersistedWorkbenchRuntimeMode | null {
  if (value === 'normal' || value === 'real-device') return 'normal'
  if (value === 'dry-run' || value === 'simulation') return 'dry-run'
  if (value === undefined || value === null) return null
  throw invalidLocalEnvironmentConfiguration(
    configurationPath,
    '本地环境配置 runtimeMode 无效'
  )
}

function persistedPlcHandshakeProfile(
  value: unknown,
  configurationPath: string
): PersistedPlcHandshakeProfile | null {
  if (value === 'szlab' || value === 'xuse') return value
  if (value === undefined || value === null) return null
  throw invalidLocalEnvironmentConfiguration(
    configurationPath,
    '本地环境配置 plcHandshakeProfile 无效'
  )
}

function persistedDomainMode(
  value: unknown,
  configurationPath: string
): PersistedWorkbenchDomainMode | null {
  if (value === 'local' || value === 'backend') return value
  if (value === undefined || value === null) return null
  throw invalidLocalEnvironmentConfiguration(
    configurationPath,
    '本地环境配置 domainMode 无效'
  )
}

function invalidLocalEnvironmentConfiguration(
  configurationPath: string,
  message: string
): WorkbenchLaunchError {
  return new WorkbenchLaunchError(
    'invalid_workspace',
    `${message}：${configurationPath}`,
    `修复或删除 ${configurationPath} 后重新启动 Workbench`
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}
