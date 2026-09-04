import {
  sceneRegistry,
  useRegistry
} from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useThree } from '@react-three/fiber'
import { shouldShowMaterialLabelByDefault } from '@unilab/material/domain'
import {
  getJointStateFrame,
  subscribeJointStateFrame
} from '@unilab/scene-runtime'
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
  loadLabDeviceModel,
  resolveModelFrameRotation
} from '../modelRuntime'
import {
  findChildAttachLink,
  findLinkObject,
  syncVirtualAttachPointFrames
} from '../mounting'
import {
  applyJointStateToUrdf,
  captureInitialJointState,
  resetJointStateUrdf
} from '../jointStateRuntime'
import type { LabDeviceNode } from '../schema'
import {
  isSiteBoundsPointerHit,
  SiteBoundsRenderer,
  siteBoundsOccupantSceneObjectId
} from './SiteBoundsRenderer'
import { PascalModelLabel } from './PascalModelLabel'
import { PASCAL_SCENE_HTML_Z_INDEX_RANGE } from './htmlLayer'
import {
  isRetryableModelLoadError,
  modelLoadRetryDelayMs
} from '../modelLoadRetry'
import { generatedBoundingBoxCenter } from './generatedBoundingBox'

export const MODEL_READY_EVENT = 'unilab:pascal-model-ready'
const MODEL_LOAD_MAX_ATTEMPTS = 12

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
    let retryTimer: ReturnType<typeof globalThis.setTimeout> | null = null
    let attempt = 0
    setLoading(true)
    setError(null)

    const load = (): void => {
      void loadLabDeviceModel(node)
        .then((nextObject) => {
          if (cancelled) {
            disposeLabModel(nextObject)
            return
          }
          setObject(nextObject)
          setError(null)
          setLoading(false)
        })
        .catch((cause: unknown) => {
          if (cancelled) return
          const message = cause instanceof Error ? cause.message : String(cause)
          if (
            isRetryableModelLoadError(message) &&
            attempt < MODEL_LOAD_MAX_ATTEMPTS
          ) {
            attempt += 1
            retryTimer = globalThis.setTimeout(
              load,
              modelLoadRetryDelayMs(attempt)
            )
            return
          }
          setError(message)
          setLoading(false)
        })
    }

    load()

    return () => {
      cancelled = true
      if (retryTimer !== null) globalThis.clearTimeout(retryTimer)
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

/**
 * 把设备物料（Material）的稳定场景身份与可点击标签关联。
 *
 * @param props 设备节点、标签坐标与选中状态。
 * @returns 精确选中该设备物料的 Pascal 标签。
 */
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
    <PascalModelLabel
      sceneObjectId={node.id}
      displayName={node.displayName}
      position={position}
      selected={selected}
    />
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

/**
 * 渲染可拾取的设备场景对象、库位（Site）与精确选择标签。
 *
 * @param props 设备节点，包含稳定身份、模型、尺寸和库位快照。
 * @returns 能将标签选择同步到物料（Material）检查器的 Pascal 设备节点。
 */
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
  const appliedJointFrameRef = useRef<object | null>(null)
  const invalidate = useThree(state => state.invalidate)
  const events = useCustomNodeEvents(node, node.type)
  const isSelected = useViewer((state) =>
    state.selection.selectedIds.includes(node.id as never)
  )
  const usesDefaultChildAttachLink = Boolean(
    node.attach.parentDeviceId &&
    node.attach.parentLinkName === '__root__' &&
    node.placementRef.anchorKind === 'root'
  )
  const modelFrameRotation = resolveModelFrameRotation(
    node.model.format,
    node.attach.parentDeviceId,
    usesDefaultChildAttachLink ? 'tool0' : node.attach.parentLinkName
  )
  const isDeck = node.deviceType.includes('deck')
  const deckSurfaceProvidedByParent =
    isDeck && Boolean(node.attach.parentDeviceId)
  const showPersistentTag = shouldShowMaterialLabelByDefault(
    node.deviceType
  )

  useRegistry(node.id, node.type, groupRef)

  // 设备自己的 latest 到达时直接命令式写入 URDF，再只唤醒一帧出图。不能依赖
  // Pascal demand frame 轮询，否则外部状态已更新时 Three joint 仍可能保持旧值。
  useEffect(() => {
    const kinematics = node.kinematics
    if (!object || !kinematics) return
    const applyLatest = (): void => {
      const frame = getJointStateFrame(node.materialNodeId)
      if (!frame) {
        if (appliedJointFrameRef.current) {
          resetJointStateUrdf(object)
          invalidate()
        }
        appliedJointFrameRef.current = null
        return
      }
      if (frame === appliedJointFrameRef.current || frame.stale ||
          !matchesKinematicContract(kinematics, frame)) return
      captureInitialJointState(object)
      if (applyJointStateToUrdf(object, frame.jointStates)) {
        appliedJointFrameRef.current = frame
        invalidate()
      }
    }
    applyLatest()
    return subscribeJointStateFrame(node.materialNodeId, applyLatest)
  }, [invalidate, node.kinematics, node.materialNodeId, object])

  useEffect(() => {
    // 模型实例变化后必须重新应用当前 latest，不能沿用旧对象引用。
    appliedJointFrameRef.current = null
  }, [object, node.materialNodeId])

  useEffect(() => {
    if (!groupRef.current) return
    originalParentRef.current ??= groupRef.current.parent
  })

  useEffect(() => {
    if (!object || !groupRef.current) return
    syncVirtualAttachPointFrames(groupRef.current, node.model.attachPoints)
  }, [node.model.attachPoints, object])

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
    const linkObject = parentObject
      ? findChildAttachLink(parentObject, parentLinkName)
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
      onPointerDown={(event) => {
        if (siteBoundsOccupantSceneObjectId(event.object)) {
          event.stopPropagation()
          return
        }
        if (!isSiteBoundsPointerHit(event.object)) {
          events.onPointerDown(event)
        }
      }}
      onPointerUp={(event) => {
        const occupantSceneObjectId = siteBoundsOccupantSceneObjectId(
          event.object
        )
        if (occupantSceneObjectId) {
          event.stopPropagation()
          useViewer.getState().setSelection({
            selectedIds: [occupantSceneObjectId as never]
          })
          return
        }
        if (!isSiteBoundsPointerHit(event.object)) {
          events.onPointerUp(event)
        }
      }}
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
          rotation={modelFrameRotation}
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
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="pascal-model-label pascal-model-label--status"
            title={error}
            data-unilab-model-failure="true"
            data-node-id={node.id}
            data-material-id={node.materialNodeId}
            data-model-path={node.model.path}
            data-model-format={node.model.format}
            data-model-error={error}
          >
            模型加载失败，已使用占位体
          </div>
        </Html>
      )}
    </group>
  )
}

function matchesKinematicContract(
  kinematics: NonNullable<LabDeviceNode['kinematics']>,
  frame: NonNullable<ReturnType<typeof getJointStateFrame>>
): boolean {
  if (frame.deviceId !== kinematics.deviceId ||
      frame.topologyDigest !== kinematics.topologyDigest) return false
  const expected = [...kinematics.qualifiedJointNames].sort()
  const actual = Object.keys(frame.jointStates).sort()
  return expected.length === actual.length &&
    expected.every((name, index) => name === actual[index])
}
