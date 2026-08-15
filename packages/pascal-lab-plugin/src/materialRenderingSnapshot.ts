import type { MaterialAggregate } from '@unilab/material/domain'
import type { MaterialRenderingSnapshot } from './materialAggregateSceneTypes'
import type { LabAttachPoint } from './schema'
import { inferModelFormat } from './modelFormat'
import { labPoseToPascal } from './units'
import {
  finiteNumber,
  optionalNumber,
  optionalString,
  pairTuple,
  readRecord,
  recordValue,
  stringArray,
  stringValue,
  vectorTuple
} from './materialSceneWire'

export function readMaterialRendering(
  aggregate: MaterialAggregate
): MaterialRenderingSnapshot {
  const config = readRecord(aggregate.material.config)
  const source = recordValue(config.rendering) ?? config
  const model = recordValue(source.model) ?? {}
  const pose = recordValue(source.pose) ?? {}
  const size = recordValue(pose.size) ?? {}
  const kind = stringValue(
    source.kind ?? source.type ?? source.resourceType,
    'custom'
  ).toLowerCase()
  const materialKind = (
    source.materialKind ?? source.material_kind
  ) === 'resource'
    ? 'resource'
    : 'device'

  const dimensionsMm =
    vectorTuple(source.dimensionsMm ?? source.sizeMm) ??
    vectorTuple(config.dimensionsMm ?? config.sizeMm) ??
    readBackendDimensions(config) ??
    [
      finiteNumber(size.width, kind === 'table' ? 1500 : 600),
      finiteNumber(size.height, kind === 'table' ? 900 : 500),
      finiteNumber(size.depth, kind === 'table' ? 750 : 600)
    ]
  const footprintMm =
    pairTuple(source.footprintMm) ??
    [dimensionsMm[0], dimensionsMm[2]]

  return {
    kind: kind === 'lab-table' || kind === 'workbench' ? 'table' : kind,
    materialKind,
    dimensionsMm,
    footprintMm,
    scale: vectorTuple(source.scale) ?? [1, 1, 1],
    model: {
      path: stringValue(model.path ?? model.mesh),
      format: optionalString(model.format ?? model.model_type),
      meshDir: optionalString(model.meshDir ?? model.mesh),
      macro: optionalString(model.macro),
      ossDir: optionalString(model.ossDir ?? model.oss_dir),
      version: optionalString(model.version),
      type: optionalString(model.type),
      color: optionalString(model.color),
      position: vectorTuple(model.position) ?? [0, 0, 0],
      rotation: vectorTuple(model.rotation) ?? [0, 0, 0],
      attachPoints: readAttachPoints(model, aggregate),
      instances: readModelInstances(model, aggregate)
    }
  }
}

/**
 * The Backend material API describes its Z-up scene as X/Y/Z, where X and Y
 * form the floor plane and Z is height. Pascal uses X/Y/Z as width, height and
 * depth, so the two horizontal axes must be projected as X/Z.
 */
function readBackendDimensions(
  config: Record<string, unknown>
): MaterialRenderingSnapshot['dimensionsMm'] | undefined {
  const sizeX = optionalNumber(config.size_x ?? config.sizeX)
  const sizeY = optionalNumber(config.size_y ?? config.sizeY)
  const sizeZ = optionalNumber(config.size_z ?? config.sizeZ)

  return sizeX == null || sizeY == null || sizeZ == null
    ? undefined
    : [sizeX, sizeZ, sizeY]
}

function readModelInstances(
  model: Record<string, unknown>,
  aggregate: MaterialAggregate
): MaterialRenderingSnapshot['model']['instances'] {
  const source = recordValue(model.instances)
  if (!source) return undefined
  const path = optionalString(source.path)
  if (!path) return undefined
  const siteKinds = stringArray(source.siteKinds) ?? []
  const visibleStates = stringArray(source.visibleStates) ?? []
  const items = aggregate.sites
    .filter(
      (site) =>
        site.visible !== false &&
        (siteKinds.length === 0 ||
          (site.kind != null && siteKinds.includes(site.kind))) &&
        (visibleStates.length === 0 ||
          (site.visual != null &&
            visibleStates.includes(site.visual.state)))
    )
    .map((site) => {
      const pose = labPoseToPascal(site.poseInAnchor)
      return {
        id: site.id,
        position: pose.position,
        rotation: pose.rotation
      }
    })
  return {
    path,
    format: inferModelFormat(path, optionalString(source.format)),
    color: optionalString(source.color),
    position: vectorTuple(source.position) ?? [0, 0, 0],
    rotation: vectorTuple(source.rotation) ?? [0, 0, 0],
    items
  }
}


function readAttachPoints(
  model: Record<string, unknown>,
  aggregate: MaterialAggregate
): LabAttachPoint[] {
  const points = new Map<string, LabAttachPoint>()
  const rawPoints = Array.isArray(model.attachPoints)
    ? model.attachPoints
    : Array.isArray(model.attach_points)
      ? model.attach_points
      : []

  for (const value of rawPoints) {
    const point = recordValue(value)
    if (!point) continue
    const link = optionalString(point.link)
    if (!link) continue
    points.set(link, {
      link,
      label: optionalString(point.label),
      row: optionalNumber(point.row),
      col: optionalNumber(point.col),
      acceptTypes: stringArray(point.acceptTypes ?? point.accept_types),
      position: vectorTuple(point.position),
      rotation: vectorTuple(point.rotation)
    })
  }

  for (const site of aggregate.sites) {
    if (site.anchor.kind !== 'link') continue
    points.set(site.anchor.linkName, {
      link: site.anchor.linkName,
      label: site.name,
      acceptTypes: [...site.allowedTemplateIds],
      position: [...site.poseInAnchor.positionMm],
      rotation: [...site.poseInAnchor.rotationDegXYZ]
    })
  }

  return [...points.values()]
}
