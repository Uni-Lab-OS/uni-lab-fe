import { BaseNode } from '@pascal-app/core'
import { z } from 'zod'

export const Vector3Schema = z.tuple([
  z.number(),
  z.number(),
  z.number()
])

const LabModelFormatSchema = z.enum([
  'xacro',
  'urdf',
  'gltf',
  'stl',
  'fbx',
  'obj'
])

const LabModelInstancesSchema = z.object({
  path: z.string(),
  format: LabModelFormatSchema,
  color: z.string().optional(),
  position: Vector3Schema.default([0, 0, 0]),
  rotation: Vector3Schema.default([0, 0, 0]),
  items: z.array(
    z.object({
      id: z.string(),
      position: Vector3Schema,
      rotation: Vector3Schema
    })
  )
})

export const LabAttachPointSchema = z.object({
  link: z.string(),
  label: z.string().optional(),
  row: z.number().optional(),
  col: z.number().optional(),
  acceptTypes: z.array(z.string()).optional(),
  position: Vector3Schema.optional(),
  rotation: Vector3Schema.optional()
})

export const LabFloorplanSiteSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  kind: z
    .enum(['site', 'deck-slot', 'well', 'tip-spot'])
    .optional(),
  shape: z.enum(['circle', 'rectangle']).optional(),
  positionMm: Vector3Schema,
  rotationDegXYZ: Vector3Schema.default([0, 0, 0]),
  sizeMm: Vector3Schema,
  visible: z.boolean().default(true),
  occupied: z.boolean().default(false),
  visualState: z
    .enum(['empty', 'occupied', 'filled', 'tip-present'])
    .default('empty')
})

/**
 * Read-only projection data for Pascal's native floor-plan plugin hook.
 * Material remains authoritative; this snapshot only prevents the Pascal
 * plugin from importing the application store or duplicating pose rules.
 */
export const LabFloorplanSnapshotSchema = z.object({
  kind: z.string(),
  worldPositionMm: Vector3Schema,
  worldRotationDegXYZ: Vector3Schema,
  footprintMm: z.tuple([z.number(), z.number()]),
  showSites: z.boolean().default(true),
  sites: z.array(LabFloorplanSiteSchema).default([])
})

export const LabPlacementRefSchema = z
  .object({
    kind: z.enum(['unplaced', 'world', 'parent', 'site']),
    parentMaterialId: z.string().nullable().default(null),
    siteId: z.string().nullable().default(null),
    anchorKind: z.enum(['root', 'link']).default('root'),
    anchorLinkName: z.string().nullable().default(null)
  })
  .default({
    kind: 'world',
    parentMaterialId: null,
    siteId: null,
    anchorKind: 'root',
    anchorLinkName: null
  })

export const LabDeviceNodeSchema = BaseNode.extend({
  type: z.literal('lab-device'),
  materialNodeId: z.string(),
  displayName: z.string().default(''),
  showLabel: z.boolean().default(true),
  deviceType: z.string().default('custom'),
  templateUuid: z.string().default(''),
  rosDeviceName: z.string().default(''),
  children: z.array(z.string()).default([]),
  position: Vector3Schema.default([0, 0, 0]),
  rotation: Vector3Schema.default([0, 0, 0]),
  scale: Vector3Schema.default([1, 1, 1]),
  dimensions: Vector3Schema.default([0.6, 0.5, 0.6]),
  materialKind: z.enum(['device', 'resource']).default('device'),
  renderBody: z.boolean().default(true),
  model: z
    .object({
      path: z.string().default(''),
      format: LabModelFormatSchema.default('gltf'),
      meshDir: z.string().optional(),
      macro: z.string().optional(),
      ossDir: z.string().optional(),
      version: z.string().optional(),
      type: z.string().optional(),
      color: z.string().optional(),
      position: Vector3Schema.default([0, 0, 0]),
      rotation: Vector3Schema.default([0, 0, 0]),
      attachPoints: z.array(LabAttachPointSchema).default([]),
      instances: LabModelInstancesSchema.optional()
    })
    .default({
      path: '',
      format: 'gltf',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      attachPoints: []
    }),
  attach: z
    .object({
      parentDeviceId: z.string().nullable().default(null),
      parentLinkName: z.string().nullable().default(null),
      mountPoint: z.string().nullable().default(null)
    })
    .default({
      parentDeviceId: null,
      parentLinkName: null,
      mountPoint: null
    }),
  placementRef: LabPlacementRefSchema,
  floorplanSnapshot: LabFloorplanSnapshotSchema.optional(),
  graphMeta: z.record(z.string(), z.unknown()).optional()
})

export const LabTableNodeSchema = BaseNode.extend({
  type: z.literal('lab-table'),
  materialNodeId: z.string(),
  displayName: z.string().default('工作台'),
  showLabel: z.boolean().default(true),
  children: z.array(z.string()).default([]),
  position: Vector3Schema.default([0, 0, 0]),
  rotation: Vector3Schema.default([0, 0, 0]),
  dimensions: Vector3Schema.default([1.5, 0.9, 0.75]),
  placementRef: LabPlacementRefSchema,
  floorplanSnapshot: LabFloorplanSnapshotSchema.optional(),
  graphMeta: z.record(z.string(), z.unknown()).optional()
})

export const LabMaterialTransferStatusSchema = z.enum([
  'planned',
  'pending',
  'running',
  'canceling',
  'succeeded',
  'failed',
  'canceled',
  'attention'
])

export const LabMaterialTransferRouteSchema = z.object({
  id: z.string(),
  workflowNodeUuid: z.string(),
  label: z.string(),
  sourceOwnerMaterialId: z.string(),
  sourceAnchorKind: z.enum(['warehouse', 'site']),
  sourceAnchorId: z.string(),
  sourceAnchorLabel: z.string(),
  sourceSiteId: z.string().nullable(),
  sourceSiteKey: z.string().nullable(),
  targetOwnerMaterialId: z.string(),
  targetAnchorKind: z.enum(['warehouse', 'site']),
  targetAnchorId: z.string(),
  targetAnchorLabel: z.string(),
  targetSiteId: z.string().nullable(),
  targetSiteKey: z.string().nullable(),
  executorId: z.string(),
  materialRole: z.string().default('unclassified'),
  materialLineageKey: z.string(),
  accent: z.string(),
  status: LabMaterialTransferStatusSchema,
  selected: z.boolean().default(false),
  points: z.array(Vector3Schema).min(2)
})

export const LabMaterialTransferLayerNodeSchema = BaseNode.extend({
  type: z.literal('lab-material-transfer-layer'),
  routes: z.array(LabMaterialTransferRouteSchema).default([]),
  unresolvedRouteIds: z.array(z.string()).default([])
})

export type LabAttachPoint = z.infer<typeof LabAttachPointSchema>
export type LabFloorplanSite = z.infer<typeof LabFloorplanSiteSchema>
export type LabFloorplanSnapshot = z.infer<
  typeof LabFloorplanSnapshotSchema
>
export type LabPlacementRef = z.infer<typeof LabPlacementRefSchema>
export type LabDeviceNode = z.infer<typeof LabDeviceNodeSchema>
export type LabTableNode = z.infer<typeof LabTableNodeSchema>
export type LabMaterialTransferStatus = z.infer<
  typeof LabMaterialTransferStatusSchema
>
export type LabMaterialTransferRoute = z.infer<
  typeof LabMaterialTransferRouteSchema
>
export type LabMaterialTransferLayerNode = z.infer<
  typeof LabMaterialTransferLayerNodeSchema
>
export type LabSceneNode = LabDeviceNode | LabTableNode

export function isLabDeviceNode(node: unknown): node is LabDeviceNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: unknown }).type === 'lab-device'
  )
}

export function isLabTableNode(node: unknown): node is LabTableNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: unknown }).type === 'lab-table'
  )
}

export function isLabMaterialTransferLayerNode(
  node: unknown
): node is LabMaterialTransferLayerNode {
  return (
    typeof node === 'object' &&
    node !== null &&
    (node as { type?: unknown }).type === 'lab-material-transfer-layer'
  )
}
