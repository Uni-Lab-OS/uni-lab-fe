import {
  sceneRegistry,
  useRegistry
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { shouldShowMaterialLabelByDefault } from '@unilab/material/domain'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import {
  Box3,
  Euler,
  type Group,
  type InstancedMesh,
  Matrix4,
  type Mesh,
  type Object3D,
  Quaternion,
  Vector3
} from 'three'

import {
  disposeLabModel,
  loadLabDeviceModel
} from '../modelRuntime'
import { findLinkObject } from '../mounting'
import type { LabDeviceNode } from '../schema'
import { SiteBoundsRenderer } from './SiteBoundsRenderer'
import { PASCAL_SCENE_HTML_Z_INDEX_RANGE } from './htmlLayer'
import { generatedBoundingBoxCenter } from './generatedBoundingBox'

export const MODEL_READY_EVENT = 'unilab:pascal-model-ready'

const useCustomNodeEvents = useNodeEvents as unknown as (
  node: LabDeviceNode,
  type: string
) => ReturnType<typeof useNodeEvents>

function useLabModel(node: LabDeviceNode): {
  object: Object3D | null
  error: string | null
  loading: boolean
} {
  const [object, setObject] = useState<Object3D | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(Boolean(node.model.path))

  useEffect(() => {
    if (!node.model.path) {
      setObject(null)
      setError(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void loadLabDeviceModel(node)
      .then((nextObject) => {
        if (cancelled) {
          disposeLabModel(nextObject)
          return
        }
        setObject(nextObject)
        setLoading(false)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    node.id,
    node.model.format,
    node.model.macro,
    node.model.meshDir,
    node.model.ossDir,
    node.model.path,
    node.model.version
  ])

  useEffect(() => {
    return () => {
      if (object) disposeLabModel(object)
    }
  }, [object])

  return { object, error, loading }
}

function ModelLabel({
  node,
  position,
  selected
}: {
  node: LabDeviceNode
  position: [number, number, number]
  selected: boolean
}): React.JSX.Element {
  return (
    <Html
      position={position}
      center
      zIndexRange={PASCAL_SCENE_HTML_Z_INDEX_RANGE}
    >
      <div
        className={`pascal-model-label${
          selected ? ' is-selected' : ''
        }`}
      >
        {node.displayName}
      </div>
    </Html>
  )
}

function SiteInstanceRenderer({
  node
}: {
  node: LabDeviceNode
}): React.JSX.Element | null {
  const instanceSource = node.model.instances
  const sourceNode = useMemo<LabDeviceNode | null>(() => {
    if (!instanceSource) return null
    return {
      ...node,
      id: `${node.id}:site-instances`,
      model: {
        path: instanceSource.path,
        format: instanceSource.format,
        color: instanceSource.color,
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        attachPoints: []
      }
    }
  }, [instanceSource, node])
  const loaded = useLabModel(sourceNode ?? node)
  const mesh = useMemo(
    () =>
      (loaded.object?.getObjectByProperty(
        'isMesh',
        true
      ) as Mesh | undefined) ?? null,
    [loaded.object]
  )
  const instancesRef = useRef<InstancedMesh>(null!)

  useLayoutEffect(() => {
    if (!instanceSource || !mesh || !instancesRef.current) return
    const sourceTransform = new Matrix4().compose(
      new Vector3(...instanceSource.position),
      new Quaternion().setFromEuler(
        new Euler(...instanceSource.rotation, 'XYZ')
      ),
      new Vector3(1, 1, 1)
    )
    const matrix = new Matrix4()
    for (const [index, item] of instanceSource.items.entries()) {
      matrix
        .compose(
          new Vector3(...item.position),
          new Quaternion().setFromEuler(
            new Euler(...item.rotation, 'XYZ')
          ),
          new Vector3(1, 1, 1)
        )
        .multiply(sourceTransform)
      instancesRef.current.setMatrixAt(index, matrix)
    }
    instancesRef.current.instanceMatrix.needsUpdate = true
    instancesRef.current.computeBoundingSphere()
  }, [instanceSource, mesh])

  if (!instanceSource || !mesh || instanceSource.items.length === 0) {
    return null
  }
  return (
    <instancedMesh
      ref={instancesRef}
      args={[mesh.geometry, mesh.material, instanceSource.items.length]}
      castShadow
      receiveShadow
    />
  )
}

export default function LabDeviceRenderer({
  node
}: {
  node: LabDeviceNode
}): React.JSX.Element {
  const groupRef = useRef<Group>(null!)
  const modelGroupRef = useRef<Group>(null!)
  const originalParentRef = useRef<Object3D | null>(null)
  const [parentModelRevision, setParentModelRevision] = useState(0)
  const [isHovered, setIsHovered] = useState(false)
  const [labelPosition, setLabelPosition] = useState<
    [number, number, number]
  >([0, Math.max(node.dimensions[1], 0.2) + 0.08, 0])
  const { object, error, loading } = useLabModel(node)
  const events = useCustomNodeEvents(node, node.type)
  const isSelected = useViewer((state) =>
    state.selection.selectedIds.includes(node.id as never)
  )
  const isZUp =
    node.model.format === 'xacro' || node.model.format === 'urdf'
  const isDeck = node.deviceType.includes('deck')
  const deckSurfaceProvidedByParent =
    isDeck && Boolean(node.attach.parentDeviceId)
  const showPersistentTag = shouldShowMaterialLabelByDefault(
    node.deviceType
  )

  useRegistry(node.id, node.type, groupRef)

  useEffect(() => {
    if (!groupRef.current) return
    originalParentRef.current ??= groupRef.current.parent
  })

  useEffect(() => {
    if (!object) return
    window.dispatchEvent(
      new CustomEvent(MODEL_READY_EVENT, {
        detail: { nodeId: node.id }
      })
    )
  }, [node.id, object])

  useLayoutEffect(() => {
    const root = groupRef.current
    const modelGroup = modelGroupRef.current
    if (!object || !root || !modelGroup) {
      setLabelPosition([
        0,
        Math.max(node.dimensions[1], 0.2) + 0.08,
        0
      ])
      return
    }

    root.updateWorldMatrix(true, true)
    modelGroup.updateWorldMatrix(true, true)
    const bounds = new Box3().setFromObject(modelGroup)
    if (bounds.isEmpty()) return
    const topCenter = bounds.getCenter(new Vector3())
    topCenter.y = bounds.max.y + 0.08
    root.worldToLocal(topCenter)
    setLabelPosition([topCenter.x, topCenter.y, topCenter.z])
  }, [
    node.dimensions,
    node.model.position,
    node.model.rotation,
    node.rotation,
    node.scale,
    object
  ])

  useEffect(() => {
    const parentDeviceId = node.attach.parentDeviceId
    if (!parentDeviceId) return

    const handleReady = (event: Event) => {
      const detail = (event as CustomEvent<{ nodeId?: string }>).detail
      if (detail?.nodeId === parentDeviceId) {
        setParentModelRevision((revision) => revision + 1)
      }
    }
    window.addEventListener(MODEL_READY_EVENT, handleReady)
    return () => window.removeEventListener(MODEL_READY_EVENT, handleReady)
  }, [node.attach.parentDeviceId])

  useEffect(() => {
    const group = groupRef.current
    if (!group) return

    const { parentDeviceId, parentLinkName } = node.attach
    if (!parentDeviceId || !parentLinkName) {
      if (originalParentRef.current && group.parent !== originalParentRef.current) {
        originalParentRef.current.attach(group)
      }
      group.position.set(...node.position)
      group.rotation.set(...node.rotation)
      return
    }

    const parentObject = sceneRegistry.nodes.get(parentDeviceId)
    const linkObject =
      parentLinkName === '__root__'
        ? parentObject
        : parentObject
          ? findLinkObject(parentObject, parentLinkName)
          : null
    if (!linkObject) return

    if (group.parent !== linkObject) linkObject.add(group)
    group.position.set(...node.position)
    group.rotation.set(...node.rotation)
  }, [
    node.attach.parentDeviceId,
    node.attach.parentLinkName,
    node.position,
    node.rotation,
    parentModelRevision
  ])

  return (
    <group
      ref={groupRef}
      name={node.id}
      position={node.position}
      rotation={node.rotation}
      scale={node.scale}
      visible={node.visible !== false}
      {...events}
      onPointerEnter={(event) => {
        setIsHovered(true)
        events.onPointerEnter(event)
      }}
      onPointerLeave={(event) => {
        setIsHovered(false)
        events.onPointerLeave(event)
      }}
    >
      {node.renderBody && !object && !deckSurfaceProvidedByParent && (
        <mesh
          position={generatedBoundingBoxCenter(
            isDeck ? 'resource' : node.materialKind,
            node.dimensions
          )}
          castShadow
          receiveShadow
        >
          <boxGeometry args={node.dimensions} />
          <meshStandardMaterial
            color={
              error
                ? '#ef4444'
                : isSelected
                  ? '#4dabf7'
                  : isDeck
                    ? '#6b7280'
                    : '#94a3b8'
            }
            metalness={0.12}
            opacity={loading ? 0.45 : isDeck ? 0.72 : 0.82}
            roughness={0.68}
            transparent
          />
        </mesh>
      )}
      {node.renderBody && object && (
        <group
          ref={modelGroupRef}
          rotation={isZUp ? [-Math.PI / 2, 0, 0] : undefined}
        >
          {/* model.position/rotation is the explicit model-to-resource datum;
              the Material group and its Sites remain in resource space. */}
          <group
            position={node.model.position}
            rotation={node.model.rotation}
          >
            <primitive object={object} />
          </group>
        </group>
      )}
      {node.model.instances && <SiteInstanceRenderer node={node} />}
      <SiteBoundsRenderer
        sites={node.floorplanSnapshot?.sites ?? []}
        showSites={node.floorplanSnapshot?.showSites ?? true}
      />
      {node.showLabel && (showPersistentTag || isHovered || isSelected) && (
        <ModelLabel
          node={node}
          position={labelPosition}
          selected={isSelected}
        />
      )}
      {node.renderBody && error && (
        <Html
          position={[0, 0.1, 0]}
          center
          distanceFactor={6}
          zIndexRange={PASCAL_SCENE_HTML_Z_INDEX_RANGE}
        >
          <div className="pascal-model-label" title={error}>
            模型加载失败，已使用占位体
          </div>
        </Html>
      )}
    </group>
  )
}
