import { emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  PascalEditorHost,
  type SceneGraph
} from '@unilab/pascal-host'
import {
  MaterialCanvas,
  MaterialObliqueCanvas
} from '@unilab/material'
import type {
  MaterialAggregate,
  MaterialShapeLibrary
} from '@unilab/material/domain'
import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from 'react'

import {
  type MaterialSceneMove,
  materialAggregatesToSceneGraph,
  sceneGraphToMaterialMoves
} from './materialAggregateSceneBridge'
import {
  configureLabModelRuntime,
  type LabModelRuntime
} from './modelRuntime'
import { preparePascalLabPlugin } from './plugin'
import {
  isLabDeviceNode,
  isLabTableNode
} from './schema'

export interface PascalLabWorkbenchProps {
  aggregates: readonly MaterialAggregate[]
  /** 设备包声明的 2.5D 外形，透传给斜二测画布。 */
  shapes?: MaterialShapeLibrary
  viewMode?: '2d' | '2.5d' | '3d' | 'split'
  projectId?: string
  modelRuntime?: LabModelRuntime
  editable?: boolean
  selectedMaterialIds?: readonly string[]
  highlightedMaterialIds?: readonly string[]
  onMaterialMoves?: (moves: readonly MaterialSceneMove[]) => void
  onSelectionChange?: (
    materialIds: readonly string[],
    sceneObjectIds: readonly string[]
  ) => void
}

export function PascalLabWorkbench({
  aggregates,
  shapes,
  viewMode = '3d',
  projectId = 'unilab-local-scene',
  modelRuntime,
  editable = false,
  selectedMaterialIds = [],
  highlightedMaterialIds = [],
  onMaterialMoves,
  onSelectionChange
}: PascalLabWorkbenchProps): React.JSX.Element {
  const [fitSceneRevision, setFitSceneRevision] = useState(0)
  const scene = useMemo(
    () =>
      materialAggregatesToSceneGraph(aggregates, {
        fitSceneRevision
      }),
    [aggregates, fitSceneRevision]
  )
  const [saveStatus, setSaveStatus] = useState<
    'saved' | 'dirty' | 'saving'
  >('saved')

  const selectedSceneObjectIds = useMemo(
    () => materialIdsToSceneObjectIds(scene, selectedMaterialIds),
    [scene, selectedMaterialIds]
  )
  const highlightedSceneObjectIds = useMemo(
    () => materialIdsToSceneObjectIds(scene, highlightedMaterialIds),
    [highlightedMaterialIds, scene]
  )

  useEffect(() => {
    const state = useViewer.getState()
    if (!sameIds(state.selection.selectedIds, selectedSceneObjectIds)) {
      state.setSelection({
        selectedIds: [...selectedSceneObjectIds] as never[]
      })
    }
  }, [selectedSceneObjectIds])

  useEffect(() => {
    const state = useViewer.getState()
    if (!sameIds(state.previewSelectedIds, highlightedSceneObjectIds)) {
      state.setPreviewSelectedIds(
        [...highlightedSceneObjectIds] as never[]
      )
    }
  }, [highlightedSceneObjectIds])

  const prepare = useCallback(async () => {
    if (modelRuntime) configureLabModelRuntime(modelRuntime)
    await preparePascalLabPlugin()
  }, [modelRuntime])

  const handleSave = useCallback(
    async (scene: SceneGraph) => {
      if (!editable) {
        setSaveStatus('saved')
        return
      }
      setSaveStatus('saving')
      onMaterialMoves?.(
        sceneGraphToMaterialMoves(scene, aggregates)
      )
      setSaveStatus('saved')
    },
    [aggregates, editable, onMaterialMoves]
  )

  const handleSelectionChange = useCallback(
    (sceneObjectIds: readonly string[]) => {
      const materialIds = sceneObjectIds.flatMap((id) => {
        const node = scene.nodes[id]
        return isLabDeviceNode(node) || isLabTableNode(node)
          ? [node.materialNodeId]
          : []
      })
      onSelectionChange?.(materialIds, sceneObjectIds)
    },
    [onSelectionChange, scene.nodes]
  )

  const statusLabel = useMemo(() => {
    if (saveStatus === 'saving') return '正在保存'
    if (saveStatus === 'dirty') return '有未保存修改'
    const count = aggregates.length
    return editable
      ? `${count} 个物料 · 已保存`
      : `${count} 个物料 · 只读`
  }, [aggregates.length, editable, saveStatus])
  const pascalViewMode = viewMode === '2.5d' ? '3d' : viewMode

  const toolbar = (
    <div className="pascal-lab-toolbar">
      <span className="pascal-lab-toolbar__title">
        实验室 {viewMode.toUpperCase()} · Pascal
      </span>
      <span className="pascal-lab-toolbar__status">{statusLabel}</span>
      {viewMode !== '2d' && (
        <div className="pascal-lab-toolbar__actions">
          <button
            type="button"
            className="pascal-lab-toolbar__button"
            onClick={() => {
              useViewer.getState().setCameraMode('orthographic')
              requestAnimationFrame(() => {
                emitter.emit('camera-controls:top-view')
                setFitSceneRevision((revision) => revision + 1)
              })
            }}
          >
            顶视图
          </button>
          <button
            type="button"
            className="pascal-lab-toolbar__button"
            onClick={() => {
              useViewer.getState().setCameraMode('perspective')
              requestAnimationFrame(() => {
                setFitSceneRevision((revision) => revision + 1)
              })
            }}
          >
            适配场景
          </button>
        </div>
      )}
    </div>
  )

  return (
    <div
      className={`pascal-lab-workbench${
        viewMode === '2.5d' ? ' is-oblique' : ''
      }`}
    >
      <div
        aria-hidden={viewMode === '2.5d'}
        className="pascal-lab-workbench__native"
      >
        <PascalEditorHost
          scene={scene}
          projectId={projectId}
          prepare={prepare}
          readOnly={!editable}
          editorViewMode={pascalViewMode}
          sceneTheme="night"
          floorplanOverlay={
            <MaterialCanvas
              floorplanOverlay
              physicalLayout
              readStatus={{ available: true }}
              moveStatus={{
                available: editable,
                reason: editable
                  ? undefined
                  : '当前服务不支持移动物料'
              }}
              selectedMaterialIds={selectedMaterialIds}
              highlightedMaterialIds={highlightedMaterialIds}
              onSelectionChange={(materialIds) => {
                onSelectionChange?.(
                  materialIds,
                  materialIdsToSceneObjectIds(scene, materialIds)
                )
              }}
            />
          }
          toolbar={toolbar}
          onDirty={() => {
            if (editable) setSaveStatus('dirty')
          }}
          onSave={handleSave}
          onSelectionChange={handleSelectionChange}
        />
      </div>
      {viewMode === '2.5d' && (
        <div className="pascal-lab-workbench__oblique">
          <MaterialObliqueCanvas
            aggregates={aggregates}
            shapes={shapes}
            selectedMaterialIds={selectedMaterialIds}
            highlightedMaterialIds={highlightedMaterialIds}
            onSelectionChange={(materialIds) => {
              onSelectionChange?.(
                materialIds,
                materialIdsToSceneObjectIds(scene, materialIds)
              )
            }}
          />
        </div>
      )}
    </div>
  )
}

function materialIdsToSceneObjectIds(
  scene: SceneGraph,
  materialIds: readonly string[]
): string[] {
  const wanted = new Set(materialIds)
  return Object.values(scene.nodes).flatMap((node) =>
    (isLabDeviceNode(node) || isLabTableNode(node)) &&
    wanted.has(node.materialNodeId)
      ? [node.id]
      : []
  )
}

function sameIds(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}
