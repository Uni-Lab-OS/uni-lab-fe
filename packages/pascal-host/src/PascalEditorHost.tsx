import {
  Editor,
  type EditorProps,
  type SceneGraph,
  useEditor,
  useScene,
  useViewer
} from '@pascal-app/editor'
import { clearSceneHistory } from '@pascal-app/core'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'

export interface PascalEditorHostProps {
  scene: SceneGraph
  projectId?: string
  prepare?: () => Promise<void> | void
  onDirty?: () => void
  onSave?: (scene: SceneGraph) => Promise<void> | void
  onSelectionChange?: (sceneObjectIds: readonly string[]) => void
  readOnly?: boolean
  toolbar?: ReactNode
  floorplanOverlay?: ReactNode
  editorViewMode?: '2d' | '3d' | 'split'
  sceneTheme?: string
  showGrid?: boolean
  editorProps?: Omit<
    EditorProps,
    'layoutVersion' | 'onDirty' | 'onLoad' | 'onSave' | 'projectId'
  >
}

/**
 * Vite/React host for the official Pascal editor. All Uni-Lab-specific node
 * registration stays outside this package and is injected through `prepare`.
 */
export function PascalEditorHost({
  scene,
  projectId,
  prepare,
  onDirty,
  onSave,
  onSelectionChange,
  readOnly = false,
  toolbar,
  floorplanOverlay,
  editorViewMode,
  sceneTheme,
  showGrid,
  editorProps
}: PascalEditorHostProps): React.JSX.Element {
  const sceneRef = useRef(scene)
  const onSaveRef = useRef(onSave)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const [isPrepared, setIsPrepared] = useState(!prepare)
  const [hasLoadedScene, setHasLoadedScene] = useState(false)
  const [prepareError, setPrepareError] = useState<Error | null>(null)

  sceneRef.current = scene
  onSaveRef.current = onSave
  onSelectionChangeRef.current = onSelectionChange

  useEffect(() => {
    if (!prepare) return

    let cancelled = false
    Promise.resolve(prepare())
      .then(() => {
        if (!cancelled) setIsPrepared(true)
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setPrepareError(
          cause instanceof Error
            ? cause
            : new Error('Pascal plugin preparation failed')
        )
      })

    return () => {
      cancelled = true
    }
  }, [prepare])

  useEffect(() => {
    return useViewer.subscribe((state, previousState) => {
      const selectedIds = state.selection.selectedIds
      if (selectedIds === previousState.selection.selectedIds) return
      onSelectionChangeRef.current?.(selectedIds)
    })
  }, [])

  useEffect(() => {
    if (!isPrepared) return
    useScene.getState().setReadOnly(readOnly)
    return () => useScene.getState().setReadOnly(false)
  }, [isPrepared, readOnly])

  useEffect(() => {
    if (!editorViewMode) return
    const applyViewMode = (): void => {
      useEditor.getState().setViewMode(editorViewMode)
    }
    applyViewMode()
    const frame = requestAnimationFrame(applyViewMode)
    const timer = window.setTimeout(applyViewMode, 100)
    const unsubscribe = useEditor.persist.onFinishHydration(applyViewMode)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      unsubscribe()
    }
  }, [editorViewMode])

  useEffect(() => {
    if (!sceneTheme) return
    const applySceneTheme = (): void => {
      const viewer = useViewer.getState()
      if (viewer.sceneTheme !== sceneTheme) {
        viewer.setSceneTheme(sceneTheme)
      }
    }
    applySceneTheme()
    const unsubscribe =
      useViewer.persist.onFinishHydration(applySceneTheme)
    return unsubscribe
  }, [sceneTheme])

  useEffect(() => {
    if (showGrid === undefined) return
    const applyGridVisibility = (): void => {
      const viewer = useViewer.getState()
      if (viewer.showGrid !== showGrid) {
        viewer.setShowGrid(showGrid)
      }
    }
    applyGridVisibility()
    const unsubscribe =
      useViewer.persist.onFinishHydration(applyGridVisibility)
    return unsubscribe
  }, [showGrid])

  useEffect(() => {
    if (!isPrepared || !hasLoadedScene) return
    const state = useScene.getState()
    const extra = {
      collections: scene.collections,
      materials: scene.materials,
      installedPlugins: scene.installedPlugins,
      hasExplicitPluginInstallState:
        scene.installedPlugins !== undefined
    } as Parameters<typeof state.setScene>[2]
    state.setScene(
      scene.nodes as Parameters<typeof state.setScene>[0],
      scene.rootNodeIds as Parameters<typeof state.setScene>[1],
      extra
    )
    clearSceneHistory()

    const viewer = useViewer.getState()
    const sceneNodes = scene.nodes as Record<
      string,
      {
        id: string
        type: string
        parentId?: string | null
      }
    >
    const activeLevel = viewer.selection.levelId
      ? sceneNodes[viewer.selection.levelId]
      : undefined
    if (activeLevel?.type !== 'level') {
      const defaultLevel = Object.values(sceneNodes).find(
        (node) => node.type === 'level'
      )
      const building = defaultLevel?.parentId
        ? sceneNodes[defaultLevel.parentId]
        : undefined
      if (defaultLevel && building?.type === 'building') {
        viewer.setSelection({
          buildingId: building.id as never,
          levelId: defaultLevel.id as never
        })
      }
    }

    const selectedIds = viewer.selection.selectedIds
    if (selectedIds.some((id) => !(id in scene.nodes))) {
      viewer.resetSelection()
    }
  }, [hasLoadedScene, isPrepared, scene])

  const loadScene = useCallback(async () => {
    const initialScene = sceneRef.current
    requestAnimationFrame(() => setHasLoadedScene(true))
    return initialScene
  }, [])
  const saveScene = useCallback(async (nextScene: SceneGraph) => {
    await onSaveRef.current?.(nextScene)
  }, [])

  if (prepareError) {
    return (
      <div className="flex h-full w-full flex-col bg-white">
        <div className="border-b border-[#fda29b] bg-[#fef3f2] px-3.5 py-1.5 text-xs text-[#b42318]">
          3D 插件初始化失败：{prepareError.message}
        </div>
      </div>
    )
  }

  if (!isPrepared) {
    return <div className="flex h-full w-full items-center justify-center text-[13px] text-[#6b7280]">正在加载 Pascal Editor…</div>
  }

  return (
    <div
      className={`pascal-editor-host${
        readOnly ? ' pascal-editor-host--read-only' : ''
      }`}
      data-pascal-scene-ready={isPrepared && hasLoadedScene}
    >
      {toolbar}
      <div className={toolbar ? 'pascal-lab-editor' : 'h-full'}>
        <Editor
          {...editorProps}
          isVersionPreviewMode={readOnly}
          layoutVersion="v1"
          onDirty={onDirty}
          onLoad={loadScene}
          onSave={saveScene}
          projectId={projectId}
        />
        {floorplanOverlay && (
          <PascalFloorplanOverlay>
            {floorplanOverlay}
          </PascalFloorplanOverlay>
        )}
      </div>
    </div>
  )
}

function PascalFloorplanOverlay({
  children
}: {
  children: ReactNode
}): React.JSX.Element {
  const viewMode = useEditor((state) => state.viewMode)
  const floorplanPaneRatio = useEditor(
    (state) => state.floorplanPaneRatio
  )
  const visible = viewMode === '2d' || viewMode === 'split'

  return (
    <div
      aria-hidden={!visible}
      className="pascal-floorplan-overlay"
      data-pascal-floorplan-overlay
      style={{
        display: visible ? undefined : 'none',
        width:
          viewMode === 'split'
            ? `calc(${floorplanPaneRatio * 100}% - 3px)`
            : '100%'
      }}
    >
      {children}
    </div>
  )
}
