import { ILogger } from '@theia/core/lib/common/logger'
import type { BackendApplicationContribution } from '@theia/core/lib/node'
import { inject, injectable } from '@theia/core/shared/inversify'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'

import {
  MATERIAL_RENDERER_CONTRACT,
  type MaterialRendererOptions,
  type MaterialRendererRequest,
  type MaterialRendererResponse,
  type MaterialRendererViewMode
} from '../common/workbench-session-protocol'
import { WorkbenchSessionService } from './workbench-session-service'

type Application = Parameters<
  NonNullable<BackendApplicationContribution['configure']>
>[0]
type Request = IncomingMessage & {
  originalUrl: string
  headers: IncomingHttpHeaders
  method: string
  body?: unknown
}
type Response = ServerResponse & {
  status(code: number): Response
  json(body: unknown): void
}

export const WORKBENCH_RENDERER_AUTOMATION_PREFIX = '/__unilab_renderer/v1'

@injectable()
export class WorkbenchRendererAutomationContribution
implements BackendApplicationContribution {
  @inject(ILogger)
  private readonly logger!: ILogger

  @inject(WorkbenchSessionService)
  private readonly sessions!: WorkbenchSessionService

  configure(app: Application): void {
    app.use(WORKBENCH_RENDERER_AUTOMATION_PREFIX, (request, response) => {
      void this.handle(request, response).catch(error => {
        const message = error instanceof Error ? error.message : String(error)
        this.logger.warn(`Workbench renderer automation failed: ${message}`)
        if (!response.headersSent) {
          response.status(500).json(errorResponse(
            randomUUID(),
            'renderer_automation_failed',
            message
          ))
        } else {
          response.end()
        }
      })
    })
  }

  private async handle(request: Request, response: Response): Promise<void> {
    const requestId = randomUUID()
    if (!await rendererRequestAuthorized(request.headers.authorization)) {
      response.status(401).json(errorResponse(
        requestId,
        'renderer_unauthorized',
        'Renderer 自动化请求未通过 Workspace Host token 校验'
      ))
      return
    }
    const route = rendererRoute(request.method, request.originalUrl)
    if (!route) {
      response.status(404).json(errorResponse(
        requestId,
        'renderer_route_not_found',
        '未知 renderer 自动化路由'
      ))
      return
    }
    let options: MaterialRendererOptions
    try {
      options = route === 'inspect'
        ? decodeMaterialRendererOptions(
            Object.fromEntries(new URL(request.originalUrl, 'http://localhost').searchParams)
          )
        : decodeMaterialRendererOptions(request.body)
    } catch (error) {
      response.status(400).json(errorResponse(
        requestId,
        'renderer_request_invalid',
        error instanceof Error ? error.message : String(error)
      ))
      return
    }
    const rendererRequest: MaterialRendererRequest = {
      requestId,
      kind: route,
      options
    }
    let result: MaterialRendererResponse
    try {
      result = await this.sessions.requestMaterialRenderer(rendererRequest)
    } catch (error) {
      response.status(503).json(errorResponse(
        requestId,
        'renderer_unavailable',
        error instanceof Error ? error.message : String(error)
      ))
      return
    }
    response.status(result.ok ? 200 : 409).json(result)
  }
}

export function rendererRoute(
  method: string,
  originalUrl: string
): MaterialRendererRequest['kind'] | null {
  const pathname = new URL(originalUrl, 'http://localhost').pathname
  if (
    method.toUpperCase() === 'GET' &&
    pathname === `${WORKBENCH_RENDERER_AUTOMATION_PREFIX}/material/scene`
  ) return 'inspect'
  if (
    method.toUpperCase() === 'POST' &&
    pathname === `${WORKBENCH_RENDERER_AUTOMATION_PREFIX}/material/capture`
  ) return 'capture'
  if (
    method.toUpperCase() === 'POST' &&
    pathname === `${WORKBENCH_RENDERER_AUTOMATION_PREFIX}/material/reload`
  ) return 'reload'
  return null
}

export function decodeMaterialRendererOptions(value: unknown): MaterialRendererOptions {
  const input = record(value)
  const view = optionalText(input.view)
  if (view && !isViewMode(view)) throw new Error(`不支持的物料视图：${view}`)
  const normalizedView = view as MaterialRendererViewMode | undefined
  const cameraPreset = optionalText(input.cameraPreset ?? input.camera)
  if (cameraPreset && cameraPreset !== 'default' && cameraPreset !== 'top') {
    throw new Error(`不支持的相机预设：${cameraPreset}`)
  }
  const normalizedCameraPreset = cameraPreset as 'default' | 'top' | undefined
  const viewportValue = input.viewport
  let viewport: MaterialRendererOptions['viewport']
  if (typeof viewportValue === 'string') {
    const match = /^(\d+)x(\d+)$/u.exec(viewportValue)
    if (!match) throw new Error('viewport 必须为 WIDTHxHEIGHT')
    viewport = validatedViewport(Number(match[1]), Number(match[2]))
  } else if (viewportValue != null) {
    const candidate = record(viewportValue)
    viewport = {
      ...validatedViewport(Number(candidate.width), Number(candidate.height)),
      ...(candidate.pixelRatio == null
        ? {}
        : { pixelRatio: boundedNumber(candidate.pixelRatio, 'pixelRatio', 0.25, 4) })
    }
  }
  const timeoutValue = input.timeoutMs ?? input.timeout
  const timeoutMs = timeoutValue == null
    ? undefined
    : boundedNumber(timeoutValue, 'timeoutMs', 100, 120_000)
  const layoutOverrides = input.layoutOverrides == null
    ? undefined
    : decodeLayoutOverrides(input.layoutOverrides)
  return {
    ...(normalizedView ? { view: normalizedView } : {}),
    ...optionalBoolean(input.showSites, 'showSites'),
    ...optionalBoolean(
      input.showMaterialTransfers,
      'showMaterialTransfers'
    ),
    ...stringList(input.selectedMaterialIds ?? input.selected, 'selectedMaterialIds'),
    ...stringList(input.hiddenMaterialIds ?? input.hidden, 'hiddenMaterialIds'),
    ...(normalizedCameraPreset
      ? { cameraPreset: normalizedCameraPreset }
      : {}),
    ...(viewport ? { viewport } : {}),
    ...(layoutOverrides ? { layoutOverrides } : {}),
    ...(timeoutMs ? { timeoutMs } : {})
  }
}

function decodeLayoutOverrides(
  value: unknown
): NonNullable<MaterialRendererOptions['layoutOverrides']> {
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown
    } catch {
      throw new Error('layoutOverrides 必须是 JSON 数组')
    }
  }
  if (!Array.isArray(value)) throw new Error('layoutOverrides 必须是数组')
  const identities = new Set<string>()
  return value.map((item, index) => {
    const input = record(item)
    const sourceNodeId = optionalText(input.sourceNodeId)
    if (!sourceNodeId || identities.has(sourceNodeId)) {
      throw new Error(`layoutOverrides[${index}].sourceNodeId 缺失或重复`)
    }
    identities.add(sourceNodeId)
    return {
      sourceNodeId,
      ...(input.positionMm == null
        ? {}
        : { positionMm: vector3(input.positionMm, `layoutOverrides[${index}].positionMm`) }),
      ...(input.rotationDegXYZ == null
        ? {}
        : { rotationDegXYZ: vector3(input.rotationDegXYZ, `layoutOverrides[${index}].rotationDegXYZ`) }),
      ...(input.assetRef == null ? {} : { assetRef: record(input.assetRef) })
    }
  })
}

function vector3(value: unknown, field: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${field} 必须是三个有限数`)
  }
  const values = value.map(Number)
  if (values.some(item => !Number.isFinite(item))) {
    throw new Error(`${field} 必须是三个有限数`)
  }
  return values as [number, number, number]
}

async function rendererRequestAuthorized(
  authorization: string | undefined
): Promise<boolean> {
  const workspace = process.env['THEIA_WORKSPACE']
  if (!workspace || !authorization?.startsWith('Bearer ')) return false
  try {
    const expected = (await readFile(
      resolve(workspace, '.unilabos/runtime/workbench/host.token'),
      'utf8'
    )).trim()
    const received = authorization.slice('Bearer '.length)
    const left = Buffer.from(expected)
    const right = Buffer.from(received)
    return left.length === right.length && timingSafeEqual(left, right)
  } catch {
    return false
  }
}

function errorResponse(
  requestId: string,
  code: string,
  message: string
): MaterialRendererResponse {
  return {
    schemaVersion: MATERIAL_RENDERER_CONTRACT,
    requestId,
    ok: false,
    error: { code, message }
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function isViewMode(value: string): value is MaterialRendererViewMode {
  return value === '2d' || value === '2.5d' || value === '3d' || value === 'split'
}

function optionalBoolean(
  value: unknown,
  field: 'showSites' | 'showMaterialTransfers'
): Pick<MaterialRendererOptions, typeof field> | {} {
  if (value == null || value === '') return {}
  if (value === true || value === 'true') return { [field]: true }
  if (value === false || value === 'false') return { [field]: false }
  throw new Error(`${field} 必须为 boolean`)
}

function stringList(
  value: unknown,
  field: 'selectedMaterialIds' | 'hiddenMaterialIds'
): Pick<MaterialRendererOptions, typeof field> | {} {
  if (value == null || value === '') return {}
  const items = Array.isArray(value)
    ? value
    : String(value).split(',').filter(Boolean)
  if (items.some(item => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} 必须为非空字符串数组`)
  }
  return { [field]: items.map(item => String(item).trim()) }
}

function validatedViewport(width: number, height: number) {
  return {
    width: boundedNumber(width, 'viewport.width', 320, 4096),
    height: boundedNumber(height, 'viewport.height', 240, 4096)
  }
}

function boundedNumber(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): number {
  const number = Number(value)
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${field} 必须在 ${minimum} 到 ${maximum} 之间`)
  }
  return number
}
