import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { join, resolve } from 'node:path'

import type { LocalRuntimeAcceptanceResult } from '../shared/localRuntime'

const DESCRIPTOR_NAME = 'unilab.acceptance.json'
const SIMULATOR_HOST = '127.0.0.1'
const SIMULATOR_PORT = 18_765
const DEVICE_CATALOG_URL =
  'http://127.0.0.1:18003/api/v1/authoring/device-catalog'

interface AcceptanceDescriptor {
  schemaVersion: 1
  package: { name: string; version: string }
  acceptance: {
    requiresSimulator: boolean
    expectedDeviceIds: string[]
  }
}

interface AcceptanceDependencies {
  canConnect?: (host: string, port: number) => Promise<boolean>
  fetchJson?: (url: string) => Promise<unknown>
}

/**
 * 执行描述文件允许声明的固定验收：PLC loopback 端口与 Edge 设备目录。
 * 描述文件不能提供 URL、命令或脚本，因此设备包无法借验收接口执行任意代码。
 */
export async function runDevicePackageAcceptance(
  workspacePath: string,
  dependencies: AcceptanceDependencies = {}
): Promise<LocalRuntimeAcceptanceResult> {
  const workspace = resolve(workspacePath)
  const descriptorPath = join(workspace, DESCRIPTOR_NAME)
  let raw: string
  try {
    raw = await readFile(descriptorPath, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return result(
        'unverified',
        '设备包未提供 unilab.acceptance.json，已保持“未验证”状态。'
      )
    }
    return result('failed', `读取验收描述失败：${errorMessage(error)}`)
  }

  let descriptor: AcceptanceDescriptor
  try {
    descriptor = parseDescriptor(raw)
  } catch (error) {
    return result('failed', errorMessage(error), descriptorPath)
  }

  try {
    if (descriptor.acceptance.requiresSimulator) {
      const available = await (dependencies.canConnect ?? canConnect)(
        SIMULATOR_HOST,
        SIMULATOR_PORT
      )
      if (!available) {
        return result(
          'failed',
          `PLC-Sim 未在 ${SIMULATOR_HOST}:${SIMULATOR_PORT} 就绪。`,
          descriptorPath,
          descriptor
        )
      }
    }
    const catalog = await (dependencies.fetchJson ?? fetchJson)(
      DEVICE_CATALOG_URL
    )
    const actualIds = collectDeviceIds(catalog)
    const missing = descriptor.acceptance.expectedDeviceIds.filter(
      (deviceId) => !actualIds.has(deviceId)
    )
    if (missing.length > 0) {
      return result(
        'failed',
        `Edge 设备目录缺少：${missing.join('、')}`,
        descriptorPath,
        descriptor
      )
    }
    return result(
      'verified',
      'PLC-Sim 与设备包启动验收通过。',
      descriptorPath,
      descriptor
    )
  } catch (error) {
    return result(
      'failed',
      `验收检查失败：${errorMessage(error)}`,
      descriptorPath,
      descriptor
    )
  }
}

function parseDescriptor(raw: string): AcceptanceDescriptor {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (error) {
    throw new Error('验收描述不是有效 JSON', { cause: error })
  }
  if (!isRecord(value) || value['schemaVersion'] !== 1) {
    throw new Error('验收描述 schemaVersion 不受支持')
  }
  const packageInfo = value['package']
  const acceptance = value['acceptance']
  if (
    !isRecord(packageInfo)
    || !nonEmptyString(packageInfo['name'])
    || !nonEmptyString(packageInfo['version'])
    || !isRecord(acceptance)
    || typeof acceptance['requiresSimulator'] !== 'boolean'
    || !Array.isArray(acceptance['expectedDeviceIds'])
    || acceptance['expectedDeviceIds'].length === 0
    || !acceptance['expectedDeviceIds'].every(nonEmptyString)
  ) {
    throw new Error('验收描述字段无效')
  }
  return value as unknown as AcceptanceDescriptor
}

function result(
  status: LocalRuntimeAcceptanceResult['status'],
  message: string,
  descriptorPath: string | null = null,
  descriptor?: AcceptanceDescriptor
): LocalRuntimeAcceptanceResult {
  return {
    status,
    message,
    checkedAt: Date.now(),
    descriptorPath,
    packageName: descriptor?.package.name ?? null,
    packageVersion: descriptor?.package.version ?? null
  }
}

function collectDeviceIds(value: unknown): Set<string> {
  const result = new Set<string>()
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value['devices'])
      ? value['devices']
      : isRecord(value) && Array.isArray(value['data'])
        ? value['data']
        : isRecord(value)
          && isRecord(value['data'])
          && Array.isArray(value['data']['items'])
          ? value['data']['items']
          : isRecord(value) && Array.isArray(value['items'])
            ? value['items']
        : []
  for (const candidate of candidates) {
    if (!isRecord(candidate)) continue
    for (const key of ['id', 'device_id', 'deviceId']) {
      const deviceId = candidate[key]
      if (nonEmptyString(deviceId)) result.add(deviceId)
    }
  }
  return result
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
  if (!response.ok) throw new Error(`设备目录返回 HTTP ${response.status}`)
  return response.json()
}

function canConnect(host: string, port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const socket = createConnection({ host, port })
    const finish = (available: boolean): void => {
      socket.destroy()
      resolvePromise(available)
    }
    socket.setTimeout(1_000)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && Boolean(value.trim())
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
