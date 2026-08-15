import { useRegistry } from '@pascal-app/core'
import { useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'

import type { LabTableNode } from '../schema'
import { PascalModelLabel } from './PascalModelLabel'
import { SiteBoundsRenderer } from './SiteBoundsRenderer'

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
    >
      <mesh position={[0, height - 0.025, 0]} castShadow receiveShadow>
        <boxGeometry args={[width, 0.05, depth]} />
        <meshStandardMaterial
          color={isSelected ? '#4dabf7' : '#8b7355'}
          metalness={0.08}
          roughness={0.75}
        />
      </mesh>
      {[
        [-width / 2 + legInset, legHeight / 2, -depth / 2 + legInset],
        [width / 2 - legInset, legHeight / 2, -depth / 2 + legInset],
        [-width / 2 + legInset, legHeight / 2, depth / 2 - legInset],
        [width / 2 - legInset, legHeight / 2, depth / 2 - legInset]
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
      <PascalModelLabel
        sceneObjectId={node.id}
        displayName={node.displayName}
        position={[0, height + 0.08, 0]}
        selected={isSelected}
      />
    </group>
  )
}
