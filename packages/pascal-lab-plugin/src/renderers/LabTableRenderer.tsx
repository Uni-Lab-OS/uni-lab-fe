import { useRegistry } from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'

import type { LabTableNode } from '../schema'
import { generatedBoundingBoxCenter } from './generatedBoundingBox'
import { PascalModelLabel } from './PascalModelLabel'
import {
  isSiteBoundsPointerHit,
  SiteBoundsRenderer,
  siteBoundsOccupantSceneObjectId
} from './SiteBoundsRenderer'

const useCustomNodeEvents = useNodeEvents as unknown as (
  node: LabTableNode,
  type: string
) => ReturnType<typeof useNodeEvents>

/**
 * 渲染可拾取的实验台场景对象及其物料（Material）标签。
 *
 * @param props 实验台节点，包含稳定身份、尺寸与库位（Site）快照。
 * @returns 可由模型或标签精确选中的 Pascal 实验台节点。
 */
export default function LabTableRenderer({
  node
}: {
  node: LabTableNode
}): React.JSX.Element {
  const groupRef = useRef<Group>(null!)
  useRegistry(node.id, node.type, groupRef)
  const events = useCustomNodeEvents(node, node.type)
  const isSelected = useViewer((state) =>
    state.selection.selectedIds.includes(node.id as never)
  )
  const [width, height, depth] = node.dimensions
  const [centerX, , centerZ] = generatedBoundingBoxCenter(node.dimensions)
  const legHeight = Math.max(height - 0.05, 0.05)
  const legInset = 0.05

  return (
    <group
      ref={groupRef}
      name={node.id}
      position={node.position}
      rotation={node.rotation}
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
    >
      <mesh
        position={[centerX, height - 0.025, centerZ]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[width, 0.05, depth]} />
        <meshStandardMaterial
          color={isSelected ? '#4dabf7' : '#8b7355'}
          metalness={0.08}
          roughness={0.75}
        />
      </mesh>
      {[
        [legInset, legHeight / 2, -depth + legInset],
        [width - legInset, legHeight / 2, -depth + legInset],
        [legInset, legHeight / 2, -legInset],
        [width - legInset, legHeight / 2, -legInset]
      ].map((position, index) => (
        <mesh
          key={index}
          position={position as [number, number, number]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[0.045, legHeight, 0.045]} />
          <meshStandardMaterial
            color="#64748b"
            metalness={0.35}
            roughness={0.55}
          />
        </mesh>
      ))}
      <SiteBoundsRenderer
        sites={node.floorplanSnapshot?.sites ?? []}
        showSites={node.floorplanSnapshot?.showSites ?? true}
      />
      {node.showLabel ? (
        <PascalModelLabel
          sceneObjectId={node.id}
          displayName={node.displayName}
          position={[centerX, height + 0.08, centerZ]}
          selected={isSelected}
        />
      ) : null}
    </group>
  )
}
