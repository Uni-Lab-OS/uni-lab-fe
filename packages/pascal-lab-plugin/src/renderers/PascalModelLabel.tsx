import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useCallback, type MouseEvent } from 'react'

import { PASCAL_SCENE_HTML_Z_INDEX_RANGE } from './htmlLayer'

export interface PascalModelLabelProps {
  /** Pascal 场景对象的稳定身份，点击标签时不经过模型射线猜测。 */
  sceneObjectId: string
  /** 物料（Material）在 3D 场景中的展示名称。 */
  displayName: string
  /** 标签相对场景对象的 Pascal 坐标。 */
  position: [number, number, number]
  /** 该场景对象是否已被选中。 */
  selected: boolean
}

/**
 * 渲染可精确选中对应场景对象的 3D 物料（Material）标签。
 *
 * @param props 场景对象身份、展示名称、标签坐标与选中状态。
 * @returns 由 Drei Html 承载、不依赖 Canvas 射线命中的标签按钮。
 */
export function PascalModelLabel({
  sceneObjectId,
  displayName,
  position,
  selected
}: PascalModelLabelProps): React.JSX.Element {
  const setSelection = useViewer((state) => state.setSelection)
  const selectSceneObject = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      event.stopPropagation()
      setSelection({ selectedIds: [sceneObjectId as never] })
    },
    [sceneObjectId, setSelection]
  )

  return (
    <Html
      position={position}
      center
      zIndexRange={PASCAL_SCENE_HTML_Z_INDEX_RANGE}
      style={{ pointerEvents: 'none' }}
    >
      <button
        type="button"
        className={`pascal-model-label${selected ? ' is-selected' : ''}`}
        aria-label={`选择物料：${displayName}`}
        aria-pressed={selected}
        onClick={selectSceneObject}
      >
        {displayName}
      </button>
    </Html>
  )
}
