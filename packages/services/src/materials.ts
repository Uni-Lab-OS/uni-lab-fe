import type {
  CreateMaterialInput,
  CreateMaterialResult,
  LabPose,
  MaterialAggregate,
  MaterialAnchor,
  MaterialGraphPort,
  MaterialPlacement,
  MaterialScope,
  MaterialSite,
  MaterialContainerLayout,
  MaterialTemplateCatalog,
  MaterialTemplateCatalogPort,
  MaterialTemplateDetail,
  MaterialTemplateGeometry,
  MaterialTemplateSummary
} from '@unilab/material'

import {
  parseShapeLibrary,
  type MaterialShapeLibrary
} from '@unilab/material/domain'

import type { BackendConfig } from './backends'
import {
  getCapabilityStatus,
  type ServerCapabilities
} from './capabilities'
import { assertCapability, ServiceError } from './errors'
import { requestData, type HttpClient } from './http'

export type {
  MaterialScope,
  MaterialTemplateCatalog,
  MaterialTemplateDetail,
  MaterialTemplateSummary
} from '@unilab/material'

export type MaterialService =
  MaterialTemplateCatalogPort &
  MaterialGraphPort

/**
 * 外形声明按后端地址缓存：它是设备包的静态资产，一次会话内不会变，而 2.5D
 * 视图每次挂载都要用。
 */
const shapeLibraryByApiUrl = new Map<string, Promise<MaterialShapeLibrary>>()

export function createMaterialService(
  http: HttpClient,
  backend: BackendConfig,
  capabilities: ServerCapabilities
): MaterialService {
  const requireReadTemplates = (): void => {
    assertCapability(
      getCapabilityStatus(
        backend,
        capabilities,
        'material.readTemplates'
      ),
      'material.readTemplates'
    )
  }

  const requireReadGraph = (): void => {
    assertCapability(
      getCapabilityStatus(
        backend,
        capabilities,
        'material.readGraph'
      ),
      'material.readGraph'
    )
  }

  const requireCreate = (): void => {
    assertCapability(
      getCapabilityStatus(
        backend,
        capabilities,
        'material.create'
      ),
      'material.create'
    )
  }

  return {
    listTemplates: async (scope) => {
      requireReadTemplates()
      assertSingletonScope(scope)

      const response = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/resource-templates'
      )
      return mapTemplateCatalog(response, backend.apiUrl)
    },

    getTemplate: async (scope, templateId) => {
      requireReadTemplates()
      assertSingletonScope(scope)

      const response = await requestData<Record<string, unknown>>(
        http,
        `/api/v1/resource-templates/${encodeURIComponent(templateId)}`
      )
      return mapTemplateDetail(response, backend.apiUrl)
    },

    getGraph: async (scope) => {
      requireReadGraph()
      assertSingletonScope(scope)

      const aggregates: MaterialAggregate[] = []
      let page = 1
      let total = Number.POSITIVE_INFINITY
      while (aggregates.length < total) {
        const response = await requestData<{
          items?: Record<string, unknown>[]
          total?: number
          page?: number
          page_size?: number
        }>(
          http,
          `/api/v1/materials?page=${page}&page_size=100`
        )
        const items = response.items ?? []
        aggregates.push(...items.map(mapMaterialAggregate))
        total = finiteNumber(response.total, aggregates.length)
        if (items.length === 0 || aggregates.length >= total) break
        page += 1
      }
      return aggregates
    },
    createMaterial: async (scope, input) => {
      requireCreate()
      assertSingletonScope(scope)
      const response = await requestData<Record<string, unknown>>(
        http,
        '/api/v1/materials',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            template_id: input.templateId,
            name: input.name,
            placement: input.placement,
            initial_contents: input.initialContents,
            ...(input.config ? { config: input.config } : {}),
            expected_revision: input.expectedRevision ?? 0,
            idempotency_key: createIdempotencyKey()
          })
        }
      )
      return mapCreateMaterialResult(response)
    },
    undoCreate: async (command) => {
      assertCapability(
        getCapabilityStatus(
          backend,
          capabilities,
          'edge.undoCreate'
        ),
        'edge.undoCreate'
      )
      await requestData<Record<string, never>>(
        http,
        `/api/v1/materials/${encodeURIComponent(command.materialId)}/undo-create`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            creation_operation_id: command.creationOperationId,
            expected_revision: command.expectedRevision,
            idempotency_key: command.idempotencyKey
          })
        }
      )
    },

    getShapeLibrary: async () => {
      const cached = shapeLibraryByApiUrl.get(backend.apiUrl)
      if (cached) return cached
      const pending = requestData<{ items?: unknown }>(
        http,
        '/api/v1/material-shapes'
      )
        .then((response) => parseShapeLibrary(response.items))
        .catch(() => {
          // 老后端没有这个端点，2.5D 退回实心包围盒即可；下次挂载再试。
          shapeLibraryByApiUrl.delete(backend.apiUrl)
          return [] as MaterialShapeLibrary
        })
      shapeLibraryByApiUrl.set(backend.apiUrl, pending)
      return pending
    },

    updateConfig: async (_command) =>
      unavailableGraphOperation('material.updateConfig'),
    move: async (_command) =>
      unavailableGraphOperation('material.move'),
    attach: async (_command) =>
      unavailableGraphOperation('material.attach'),
    detach: async (_command) =>
      unavailableGraphOperation('material.detach'),
    updateSite: async (_command) =>
      unavailableGraphOperation('material.updateSite'),
    getEdgeOperations: async (_scope, _operationIds) =>
      unavailableGraphOperation('edge.provisioning')
  }

  function unavailableGraphOperation(
    capability: import('./capabilities').ServerCapability
  ): never {
    assertCapability(
      getCapabilityStatus(backend, capabilities, capability),
      capability
    )
    throw new ServiceError({
      code: 'MATERIAL_GRAPH_ADAPTER_NOT_IMPLEMENTED',
      message: `${capability} 已声明，但当前 adapter 尚未实现`,
      retryable: false
    })
  }
}

function assertSingletonScope(scope: MaterialScope): void {
  if (scope.kind === 'singleton') return
  throw new ServiceError({
    code: 'UNSUPPORTED_MATERIAL_SCOPE',
    message: '当前 Material adapter 只支持 singleton scope',
    retryable: false
  })
}

function mapTemplateSummary(
  raw: Record<string, unknown>,
  apiUrl: string
): MaterialTemplateSummary {
  const kind = raw.kind
  if (kind !== 'device' && kind !== 'resource') {
    throw invalidTemplate('kind must be device or resource')
  }
  const status = raw.status
  if (status !== 'ready' && status !== 'unresolved') {
    throw invalidTemplate('status must be ready or unresolved')
  }
  const creation = recordValueForTemplate(raw.creation, 'creation')
  const mode = creation.mode
  if (mode !== 'dynamic-device' && mode !== 'resource-tree') {
    throw invalidTemplate('creation.mode is invalid')
  }
  return {
    uuid: requiredTemplateString(raw.uuid, 'uuid'),
    key: requiredTemplateString(raw.key, 'key'),
    sourceNamespace: requiredTemplateString(
      raw.source_namespace,
      'source_namespace'
    ),
    kind,
    displayName: requiredTemplateString(
      raw.display_name,
      'display_name'
    ),
    tags: templateStringArray(raw.tags),
    categoryPath: templateStringArray(raw.category_path),
    icon: resolveAssetReference(apiUrl, optionalString(raw.icon)),
    description: optionalString(raw.description),
    status,
    statusReason: optionalString(raw.status_reason),
    contentHash: requiredTemplateString(
      raw.content_hash,
      'content_hash'
    ),
    creation: {
      mode,
      available: creation.available === true,
      reason: optionalString(creation.reason)
    }
  }
}

function mapTemplateDetail(
  raw: Record<string, unknown>,
  apiUrl: string
): MaterialTemplateDetail {
  const assets = isRecord(raw.assets) ? raw.assets : {}
  return {
    ...mapTemplateSummary(raw, apiUrl),
    geometry: mapTemplateGeometry(raw.geometry),
    containerLayout: mapContainerLayout(raw.container_layout),
    compatibility: mapCompatibility(raw.compatibility),
    configuration: mapConfiguration(raw.configuration),
    assets: Object.fromEntries(
      Object.entries(assets)
        .filter((entry): entry is [string, string] =>
          typeof entry[1] === 'string'
        )
        .map(([key, value]) => [
          key,
          resolveAssetReference(apiUrl, value) ?? value
        ])
    )
  }
}

function mapTemplateCatalog(
  raw: Record<string, unknown>,
  apiUrl: string
): MaterialTemplateCatalog {
  if (!Array.isArray(raw.items) || raw.items.some((item) => !isRecord(item))) {
    throw invalidTemplate('items must be an object array')
  }
  return {
    revision: requiredTemplateString(raw.revision, 'revision'),
    stale: raw.stale === true,
    items: raw.items.map((item) => mapTemplateSummary(item, apiUrl))
  }
}

function mapTemplateGeometry(
  value: unknown
): MaterialTemplateGeometry | undefined {
  if (value == null) return undefined
  const raw = recordValueForTemplate(value, 'geometry')
  const footprint = isRecord(raw.footprint) &&
    Array.isArray(raw.footprint.points_mm)
      ? {
          pointsMm: raw.footprint.points_mm.map((point) => {
            const item = recordValueForTemplate(
              point,
              'geometry.footprint.points_mm'
            )
            return {
              x: finiteTemplateNumber(item.x, 'point.x'),
              y: finiteTemplateNumber(item.y, 'point.y')
            }
          })
        }
      : undefined
  return {
    dimensionsMm: templateVector(raw.dimensions_mm, 'dimensions_mm'),
    originMm: templateVector(raw.origin_mm, 'origin_mm'),
    footprint,
    stackHeightMm:
      raw.stack_height_mm == null
        ? undefined
        : finiteTemplateNumber(raw.stack_height_mm, 'stack_height_mm')
  }
}

function mapContainerLayout(
  value: unknown
): MaterialContainerLayout | undefined {
  if (value == null) return undefined
  const raw = recordValueForTemplate(value, 'container_layout')
  if (raw.type === 'grid') {
    const geometry = recordValueForTemplate(
      raw.geometry,
      'container_layout.geometry'
    )
    return {
      type: 'grid',
      containerKind: containerKind(raw.container_kind),
      rows: templateStringArray(raw.rows),
      columns: finiteTemplateNumber(raw.columns, 'columns'),
      columnLabels: numberArray(raw.column_labels),
      naming: 'row-column',
      geometry: {
        ...containerGeometry(geometry),
        pitchMm: templatePoint(geometry.pitch_mm, 'pitch_mm'),
        offsetMm: templateVector(geometry.offset_mm, 'offset_mm'),
        firstKey: requiredTemplateString(
          geometry.first_key,
          'first_key'
        )
      }
    }
  }
  if (raw.type === 'explicit' && Array.isArray(raw.containers)) {
    return {
      type: 'explicit',
      containers: raw.containers.map((value) => {
        const item = recordValueForTemplate(value, 'container')
        return {
          key: requiredTemplateString(item.key, 'container.key'),
          kind: containerKind(item.kind),
          positionMm: templateVector(
            item.position_mm,
            'container.position_mm'
          ),
          geometry: isRecord(item.geometry)
            ? containerGeometry(item.geometry)
            : {}
        }
      })
    }
  }
  throw invalidTemplate('container_layout.type is invalid')
}

function containerGeometry(
  raw: Record<string, unknown>
): {
  dimensionsMm: { x: number; y: number; z: number }
  depthMm: number
  shape: 'circle' | 'rectangle'
  maxVolumeUl?: number
} {
  return {
    dimensionsMm: templateVector(
      raw.dimensions_mm,
      'container.dimensions_mm'
    ),
    depthMm: finiteTemplateNumber(raw.depth_mm, 'container.depth_mm'),
    shape: raw.shape === 'circle' ? 'circle' : 'rectangle',
    maxVolumeUl:
      raw.max_volume_ul == null
        ? undefined
        : finiteTemplateNumber(
            raw.max_volume_ul,
            'container.max_volume_ul'
          )
  }
}

function mapCompatibility(
  value: unknown
): MaterialTemplateDetail['compatibility'] {
  const raw = isRecord(value) ? value : {}
  return {
    allowedParentTypes: optionalStringArray(raw.allowed_parent_types),
    allowedSiteTypes: optionalStringArray(raw.allowed_site_types),
    requiredCapabilities: optionalStringArray(
      raw.required_capabilities
    ),
    forbiddenSiteTypes: optionalStringArray(
      raw.forbidden_site_types
    )
  }
}

function mapConfiguration(
  value: unknown
): MaterialTemplateDetail['configuration'] {
  const raw = isRecord(value) ? value : {}
  return {
    schema: isRecord(raw.schema) ? raw.schema : {},
    uiSchema: isRecord(raw.ui_schema) ? raw.ui_schema : {}
  }
}

function containerKind(
  value: unknown
): 'well' | 'tip-spot' | 'container' {
  return value === 'well' || value === 'tip-spot'
    ? value
    : 'container'
}

function templateVector(
  value: unknown,
  field: string
): { x: number; y: number; z: number } {
  const raw = recordValueForTemplate(value, field)
  return {
    x: finiteTemplateNumber(raw.x, `${field}.x`),
    y: finiteTemplateNumber(raw.y, `${field}.y`),
    z: finiteTemplateNumber(raw.z, `${field}.z`)
  }
}

function templatePoint(
  value: unknown,
  field: string
): { x: number; y: number } {
  const raw = recordValueForTemplate(value, field)
  return {
    x: finiteTemplateNumber(raw.x, `${field}.x`),
    y: finiteTemplateNumber(raw.y, `${field}.y`)
  }
}

function numberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw invalidTemplate('column_labels must be an array')
  }
  return value.map((item) =>
    finiteTemplateNumber(item, 'column_labels')
  )
}

function templateStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? templateStringArray(value) : undefined
}

function requiredTemplateString(
  value: unknown,
  field: string
): string {
  const result = optionalString(value)?.trim()
  if (!result) throw invalidTemplate(`${field} is required`)
  return result
}

function finiteTemplateNumber(value: unknown, field: string): number {
  const result = Number(value)
  if (!Number.isFinite(result)) {
    throw invalidTemplate(`${field} must be finite`)
  }
  return result
}

function recordValueForTemplate(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (isRecord(value)) return value
  throw invalidTemplate(`${field} must be an object`)
}

function resolveAssetReference(
  apiUrl: string,
  value: string | undefined
): string | undefined {
  if (!value?.startsWith('/')) return value
  return `${apiUrl.replace(/\/$/, '')}${value}`
}

function invalidTemplate(message: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_RESOURCE_TEMPLATE_RESPONSE',
    message,
    retryable: false
  })
}

function mapCreateMaterialResult(
  raw: Record<string, unknown>
): CreateMaterialResult {
  if (
    !Array.isArray(raw.aggregates) ||
    raw.aggregates.some((aggregate) => !isRecord(aggregate))
  ) {
    throw invalidGraph('create.aggregates must be an object array')
  }
  const edgeSyncState = raw.edge_sync_state
  if (
    edgeSyncState !== 'not-required' &&
    edgeSyncState !== 'pending' &&
    edgeSyncState !== 'synced' &&
    edgeSyncState !== 'failed'
  ) {
    throw invalidGraph('create.edge_sync_state is invalid')
  }
  return {
    aggregates: raw.aggregates.map(mapMaterialAggregate),
    primaryMaterialId: requiredString(
      raw.primary_material_id,
      'primary_material_id'
    ),
    creationOperationId: requiredString(
      raw.creation_operation_id,
      'creation_operation_id'
    ),
    edgeSyncState
  }
}

function mapMaterialAggregate(
  raw: Record<string, unknown>
): MaterialAggregate {
  const config = recordValue(raw.config)
  const placement = parsePlacement(config.placement)
  const sites = Array.isArray(config.sites)
    ? config.sites.map(parseSite)
    : []
  const id = requiredString(raw.uuid, 'uuid')

  for (const site of sites) {
    if (site.ownerMaterialId !== id) {
      throw invalidGraph(
        `Site ${site.id} owner ${site.ownerMaterialId} does not match ${id}`
      )
    }
  }

  return {
    material: {
      id,
      sourceTemplateId: requiredString(
        raw.resource_template_uuid,
        'resource_template_uuid'
      ),
      code: requiredString(raw.code, 'code'),
      name: requiredString(raw.name, 'name'),
      description: optionalString(raw.description),
      config,
      createdAt: requiredString(raw.create_time, 'create_time'),
      updatedAt: requiredString(raw.update_time, 'update_time')
    },
    placement,
    sites,
    revision: Math.max(1, finiteNumber(raw.revision, 1))
  }
}

function parsePlacement(value: unknown): MaterialPlacement {
  const raw = recordValue(value)
  const kind = requiredString(raw.kind, 'config.placement.kind')
  if (kind === 'unplaced') return { kind }
  if (kind === 'world') {
    return {
      kind,
      pose: parsePose(raw.pose, 'config.placement.pose')
    }
  }
  if (kind === 'parent') {
    return {
      kind,
      parentId: requiredString(
        raw.parentId,
        'config.placement.parentId'
      ),
      anchor: parseAnchor(raw.anchor),
      localPose: parsePose(
        raw.localPose,
        'config.placement.localPose'
      )
    }
  }
  if (kind === 'site') {
    return {
      kind,
      parentId: requiredString(
        raw.parentId,
        'config.placement.parentId'
      ),
      siteId: requiredString(
        raw.siteId,
        'config.placement.siteId'
      ),
      offsetPose: parsePose(
        raw.offsetPose,
        'config.placement.offsetPose'
      )
    }
  }
  throw invalidGraph(`Unsupported placement kind: ${kind}`)
}

function parseAnchor(value: unknown): MaterialAnchor {
  const raw = recordValue(value)
  const kind = requiredString(raw.kind, 'anchor.kind')
  if (kind === 'root') return { kind }
  if (kind === 'link') {
    return {
      kind,
      linkName: requiredString(raw.linkName, 'anchor.linkName')
    }
  }
  throw invalidGraph(`Unsupported anchor kind: ${kind}`)
}

function parseSite(value: unknown): MaterialSite {
  const raw = recordValue(value)
  const visual = isRecord(raw.visual) ? raw.visual : undefined
  return {
    id: requiredString(raw.id, 'site.id'),
    ownerMaterialId: requiredString(
      raw.ownerMaterialId,
      'site.ownerMaterialId'
    ),
    key: requiredString(raw.key, 'site.key'),
    name: requiredString(raw.name, 'site.name'),
    anchor: parseAnchor(raw.anchor),
    poseInAnchor: parsePose(raw.poseInAnchor, 'site.poseInAnchor'),
    sizeMm: parseTuple(raw.sizeMm, 'site.sizeMm'),
    capacity: Math.max(1, finiteNumber(raw.capacity, 1)),
    allowedTemplateIds: stringArray(raw.allowedTemplateIds),
    occupiedMaterialIds: stringArray(raw.occupiedMaterialIds),
    kind: siteKind(raw.kind),
    shape:
      raw.shape === 'circle' || raw.shape === 'rectangle'
        ? raw.shape
        : undefined,
    visible: raw.visible == null ? true : Boolean(raw.visible),
    maxVolumeUl:
      raw.maxVolumeUl == null
        ? undefined
        : Math.max(0, finiteNumber(raw.maxVolumeUl)),
    visual: visual
      ? {
          state: siteVisualState(visual.state),
          fillFraction: Math.min(
            Math.max(finiteNumber(visual.fillFraction), 0),
            1
          )
        }
      : undefined
  }
}

function siteKind(value: unknown): MaterialSite['kind'] {
  return value === 'site' ||
    value === 'deck-slot' ||
    value === 'well' ||
    value === 'tip-spot'
    ? value
    : undefined
}

function siteVisualState(
  value: unknown
): NonNullable<MaterialSite['visual']>['state'] {
  return value === 'occupied' ||
    value === 'filled' ||
    value === 'tip-present'
    ? value
    : 'empty'
}

function parsePose(value: unknown, field: string): LabPose {
  const raw = recordValue(value)
  return {
    positionMm: parseTuple(raw.positionMm, `${field}.positionMm`),
    rotationDegXYZ: parseTuple(
      raw.rotationDegXYZ,
      `${field}.rotationDegXYZ`
    )
  }
}

function parseTuple(
  value: unknown,
  field: string
): readonly [number, number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    value.some((entry) => !Number.isFinite(Number(entry)))
  ) {
    throw invalidGraph(`${field} must contain three finite numbers`)
  }
  return [Number(value[0]), Number(value[1]), Number(value[2])]
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((entry) => String(entry))
    : []
}

function requiredString(value: unknown, field: string): string {
  const result = optionalString(value)?.trim()
  if (!result) throw invalidGraph(`${field} is required`)
  return result
}

function recordValue(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  throw invalidGraph('Material graph field must be an object')
}

function invalidGraph(message: string): ServiceError {
  return new ServiceError({
    code: 'INVALID_MATERIAL_GRAPH_RESPONSE',
    message,
    retryable: false
  })
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value)
}

function optionalString(value: unknown): string | undefined {
  return value == null ? undefined : String(value)
}

function finiteNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function createIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ??
    `material-create-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
