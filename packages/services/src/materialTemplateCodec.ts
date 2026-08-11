import type {
  MaterialContainerLayout,
  MaterialTemplateCatalog,
  MaterialTemplateDetail,
  MaterialTemplateGeometry,
  MaterialTemplateSummary
} from '@unilab/material'

import { ServiceError } from './errors'
import { isRecord, optionalString } from './materialCodecPrimitives'

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
    catalogSection: mapTemplateCatalogSection(raw.catalog_section),
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

/**
 * 解析 ResourceTemplate 的应用目录分区。
 * @param value Edge 返回的 `catalog_section` 原始值。
 * @returns 缺失时返回 `undefined`，否则返回封闭的物料或试剂目录标识。
 * @throws {ServiceError} 已声明但不属于稳定枚举时拒绝整个模板响应，避免错误分流。
 */
function mapTemplateCatalogSection(
  value: unknown
): MaterialTemplateSummary['catalogSection'] {
  if (value == null) return undefined
  if (value === 'material' || value === 'reagent') return value
  throw invalidTemplate('catalog_section must be material or reagent')
}

export function mapTemplateDetail(
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

export function mapTemplateCatalog(
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
