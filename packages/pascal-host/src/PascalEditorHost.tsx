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
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react'

import { exceedsSelectionDragThreshold } from './selectionGesture'

const PASCAL_INTERACTION_LABELS: Readonly<Record<string, string>> = {
  Pan: '平移',
  Rotate: '右键',
  Zoom: '缩放',
  Dismiss: '关闭'
}

/** 将 Pascal 内置的相机操作提示适配为工作台中文文案。 */
function translatePascalInteractionLabels(root: HTMLElement): void {
  root.querySelectorAll('span').forEach((label) => {
    const translated = PASCAL_INTERACTION_LABELS[label.textContent?.trim() ?? '']
    if (translated) label.textContent = translated
  })

  root.querySelectorAll<HTMLElement>(
    'section[aria-label="Camera controls hint"]'
  ).forEach((hint) => {
    hint.setAttribute('aria-label', '3D 视角操作提示')
    hint.parentElement?.classList.add(
      'unilab-camera-controls-hint-anchor'
    )
    const dismiss = hint.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss camera controls hint"]'
    )
    dismiss?.setAttribute('aria-label', '关闭操作提示')
    dismiss?.setAttribute('title', '关闭')
  })
}

export interface PascalEditorHostProps {
  scene: SceneGraph
  projectId?: string
  prepare?: () => Promise<void> | void
  onDirty?: () => void
  onSave?: (scene: SceneGraph) => Promise<void> | void
  onSelectionChange?: (sceneObjectIds: readonly string[]) => void
  /** 旋转或平移 3D 视角时撤销 Pascal 产生的临时节点选择。 */
  suppressSelectionAfterPointerDrag?: boolean
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
  suppressSelectionAfterPointerDrag = false,
  readOnly = false,
  toolbar,
  floorplanOverlay,
  editorViewMode,
  sceneTheme,
  showGrid,
  editorProps
}: PascalEditorHostProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef(scene)
  const onSaveRef = useRef(onSave)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const suppressSelectionAfterPointerDragRef = useRef(
    suppressSelectionAfterPointerDrag
  )
  const pointerGestureRef = useRef<{
    pointerId: number
    start: { x: number; y: number }
    moved: boolean
    previousSelectedIds: readonly string[]
    pendingSelectedIds: readonly string[] | null
  } | null>(null)
  const suppressSelectionUntilRef = useRef(0)
  const restoringSelectionRef = useRef(false)
  const [isPrepared, setIsPrepared] = useState(!prepare)
  const [hasLoadedScene, setHasLoadedScene] = useState(false)
  const [prepareError, setPrepareError] = useState<Error | null>(null)

  sceneRef.current = scene
  onSaveRef.current = onSave
  onSelectionChangeRef.current = onSelectionChange
  suppressSelectionAfterPointerDragRef.current =
    suppressSelectionAfterPointerDrag

  useEffect(() => {
    const root = hostRef.current
    if (!root) return

    translatePascalInteractionLabels(root)
    const observer = new MutationObserver(() => {
      translatePascalInteractionLabels(root)
    })
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true
    })
    return () => observer.disconnect()
  }, [isPrepared])

  const restoreViewerSelection = useCallback((
    selectedIds: readonly string[]
  ): void => {
    restoringSelectionRef.current = true
    try {
      useViewer.getState().setSelection({
        selectedIds: [...selectedIds] as never[]
      })
    } finally {
      restoringSelectionRef.current = false
    }
  }, [])

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
      if (restoringSelectionRef.current) return
      if (suppressSelectionAfterPointerDragRef.current) {
        const gesture = pointerGestureRef.current
        if (gesture) {
          gesture.pendingSelectedIds = selectedIds
          return
        }
        if (performance.now() <= suppressSelectionUntilRef.current) {
          restoreViewerSelection(previousState.selection.selectedIds)
          return
        }
      }
      onSelectionChangeRef.current?.(selectedIds)
    })
  }, [restoreViewerSelection])

  const handlePointerDownCapture = useCallback((
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    if (!suppressSelectionAfterPointerDrag) return
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      moved: false,
      previousSelectedIds: [...useViewer.getState().selection.selectedIds],
      pendingSelectedIds: null
    }
  }, [suppressSelectionAfterPointerDrag])

  const handlePointerMoveCapture = useCallback((
    event: ReactPointerEvent<HTMLDivElement>
  ): void => {
    const gesture = pointerGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return
    gesture.moved = exceedsSelectionDragThreshold(
      gesture.start,
      { x: event.clientX, y: event.clientY }
    )
  }, [])

  const finishPointerGesture = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
    canceled = false
  ): void => {
    const gesture = pointerGestureRef.current
    if (!gesture || gesture.pointerId !== event.pointerId) return
    pointerGestureRef.current = null
    if (gesture.moved || canceled) {
      // Pascal may select on pointerdown, pointerup or the following click.
      // Keep the guard alive through the click task, then restore the stable selection.
      suppressSelectionUntilRef.current = performance.now() + 150
      restoreViewerSelection(gesture.previousSelectedIds)
      return
    }
    if (gesture.pendingSelectedIds) {
      onSelectionChangeRef.current?.(gesture.pendingSelectedIds)
    }
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
      ref={hostRef}
      className={`pascal-editor-host${
        readOnly ? ' pascal-editor-host--read-only' : ''
      }`}
      data-pascal-scene-ready={isPrepared && hasLoadedScene}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMoveCapture={handlePointerMoveCapture}
      onPointerUpCapture={finishPointerGesture}
      onPointerCancelCapture={(event) => finishPointerGesture(event, true)}
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
