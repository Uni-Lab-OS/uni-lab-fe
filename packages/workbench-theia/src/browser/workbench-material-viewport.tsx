import {
  inspectMaterialSceneReadiness,
  MaterialCapabilityNotice,
  readStoredMaterialViewportState,
  UnifiedMaterialViewport,
  useMaterialStore,
  useMaterialStoreApi,
  writeStoredMaterialViewportState,
  type MaterialAggregate,
  type MaterialViewportState,
  type MaterialWorkbenchViewportProps
} from '@unilab/material'
import type {
  MaterialSceneSourceIdentity,
  MaterialSceneMove,
  MaterialTransferSceneRoute
} from '@unilab/pascal-lab-plugin'
import { ensurePascalRendererDefaults } from '@unilab/pascal-host'
import {
  activateSceneRuntimeScope,
  publishKinematicAttachmentFrame,
  publishJointStateFrame,
  replaceKinematicAttachmentSnapshot,
  replaceJointStateSnapshot,
  type KinematicAttachmentFrameInput,
  type JointStateFrameInput
} from '@unilab/scene-runtime'
import type {
  DeviceJointStateFrame,
  DeviceKinematicAttachmentFrame,
  RealtimeService
} from '@unilab/services'
import type { WorkflowPanelRuntimeProjection } from '@unilab/workflow-editor'
import { toCanvas } from 'html-to-image'
import * as React from 'react'
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import {
  MATERIAL_RENDERER_CONTRACT,
  type MaterialRendererOptions,
  type MaterialRendererLayoutOverride,
  type MaterialRendererRequest,
  type MaterialRendererResponse
} from '../common/workbench-session-protocol'
import type { WorkbenchSessionClientImpl } from './workbench-session-client'
import { useWorkbenchMaterialGraphLoad } from './workbench-material-graph-load'
import { resolveWorkbenchModelUrl } from './workbench-model-url'
import {
  WorkbenchMaterialSceneState,
  WorkbenchMaterialShapeFallbackNotice
} from './workbench-material-scene-state'

ensurePascalRendererDefaults()

const PascalLabWorkbench = React.lazy(async () => {
  const module = await import('@unilab/pascal-lab-plugin')
  return { default: module.PascalLabWorkbench }
})

/** 在 Workbench 中组合物料图存储与 Pascal 视口。 */
export function WorkbenchMaterialViewport({
  backendUrl,
  realtime,
  jointRealtimeEnabled,
  attachmentRealtimeEnabled,
  runtimeScopeId,
  sourceIdentity,
  sessionClient,
  runtimeProjection,
  selectedWorkflowNode,
  cameraFocus,
  readStatus,
  moveStatus,
  selectedMaterialIds,
  highlightedMaterialIds,
  onSelectionChange
}: MaterialWorkbenchViewportProps & {
  backendUrl: string
  realtime: RealtimeService
  jointRealtimeEnabled: boolean
  attachmentRealtimeEnabled: boolean
  runtimeScopeId: string
  sourceIdentity: MaterialSceneSourceIdentity
  sessionClient: WorkbenchSessionClientImpl
  runtimeProjection: WorkflowPanelRuntimeProjection | null
  selectedWorkflowNode: string | null
  cameraFocus?: 'scene' | 'kinematics'
}): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const captureActive = useRef(false)
  const pendingPascalCapture = useRef<{
    resolve(blob: Blob): void
    reject(error: Error): void
    timeout: ReturnType<typeof setTimeout>
  } | null>(null)
  const [viewState, setViewState] = useState<MaterialViewportState>(
    readStoredMaterialViewportState
  )
  const [automationOptions, setAutomationOptions] =
    useState<MaterialRendererOptions | null>(null)
  const [automationRevision, setAutomationRevision] = useState(0)
  const [pascalCaptureRequest, setPascalCaptureRequest] = useState<{
    revision: number
    width: number
    height: number
  } | null>(null)
  const store = useMaterialStoreApi()
  const aggregatesById = useMaterialStore((state) => state.aggregatesById)
  const shapeLibrary = useMaterialStore((state) => state.shapeLibrary)
  const shapeLibraryState = useMaterialStore(
    (state) => state.shapeLibraryState
  )
  const loadState = useMaterialStore((state) => state.loadState)
  const graphError = useMaterialStore((state) => state.error)
  const aggregates = useMemo(
    () => Object.values(aggregatesById),
    [aggregatesById]
  )
  const displayedViewState = useMemo<MaterialViewportState>(() => ({
    mode: automationOptions?.view ?? viewState.mode,
    showSites: automationOptions?.showSites ?? viewState.showSites,
    showMaterialTransfers:
      automationOptions?.showMaterialTransfers ?? viewState.showMaterialTransfers,
    showMaterialLabels: viewState.showMaterialLabels
  }), [automationOptions, viewState])
  const displayedAggregates = useMemo(() => {
    const adjusted = applyLayoutOverrides(
      aggregates,
      automationOptions?.layoutOverrides ?? []
    )
    const hidden = new Set(automationOptions?.hiddenMaterialIds ?? [])
    return hidden.size === 0
      ? adjusted
      : adjusted.filter(aggregate => !hidden.has(aggregate.material.id))
  }, [aggregates, automationOptions?.hiddenMaterialIds, automationOptions?.layoutOverrides])
  const displayedSelectedMaterialIds =
    automationOptions?.selectedMaterialIds ?? selectedMaterialIds
  const materialTransferRoutes = useMemo<MaterialTransferSceneRoute[]>(
    () => (runtimeProjection?.materialTransferRoutes ?? []).map((route) => ({
      ...route,
      selected: route.workflowNodeUuid === selectedWorkflowNode
    })),
    [runtimeProjection, selectedWorkflowNode]
  )
  const sceneReadiness = useMemo(
    () => inspectMaterialSceneReadiness(aggregates),
    [aggregates]
  )
  const modelRuntime = useMemo(() => ({
    /** 把包内相对模型路径解析到当前 OS 地址。 */
    resolveUrl: (model: { path: string }) =>
      resolveWorkbenchModelUrl(backendUrl, model.path)
  }), [backendUrl])

  useEffect(() => {
    activateSceneRuntimeScope(runtimeScopeId)
    if (loadState !== 'ready' ||
        (!jointRealtimeEnabled && !attachmentRealtimeEnabled)) return
    const projectJoint = (frame: DeviceJointStateFrame): JointStateFrameInput => ({
      ...frame,
      source: 'live'
    })
    const closeJoint = jointRealtimeEnabled
      ? realtime.subscribeJointState({
          onJointState: frame => publishJointStateFrame(projectJoint(frame)),
          onSnapshot: frames => replaceJointStateSnapshot(frames.map(projectJoint))
        })
      : () => undefined
    const projectAttachment = (
      frame: DeviceKinematicAttachmentFrame
    ): KinematicAttachmentFrameInput | null => {
      const aggregate = store.getState().aggregatesById[frame.childRef]
      return aggregate
        ? { ...frame, materialRevision: aggregate.revision }
        : null
    }
    const closeAttachment = attachmentRealtimeEnabled
      ? realtime.subscribeKinematicAttachment({
          onAttachment: frame => {
            const projected = projectAttachment(frame)
            if (projected) publishKinematicAttachmentFrame(projected)
          },
          onSnapshot: frames => replaceKinematicAttachmentSnapshot(
            frames.flatMap(frame => {
              const projected = projectAttachment(frame)
              return projected ? [projected] : []
            })
          )
        })
      : () => undefined
    return () => {
      closeAttachment()
      closeJoint()
    }
  }, [
    attachmentRealtimeEnabled,
    jointRealtimeEnabled,
    loadState,
    realtime,
    runtimeScopeId,
    store
  ])

  const inspectScene = useCallback(async (
    options: MaterialRendererOptions
  ) => {
    const module = await import('@unilab/pascal-lab-plugin')
    const adjusted = applyLayoutOverrides(
      aggregates,
      options.layoutOverrides ?? []
    )
    return module.inspectMaterialAggregateScene(adjusted, {
      viewMode: options.view ?? viewState.mode,
      showSites: options.showSites ?? viewState.showSites,
      showMaterialTransfers:
        options.showMaterialTransfers ?? viewState.showMaterialTransfers,
      selectedMaterialIds: options.selectedMaterialIds ?? selectedMaterialIds,
      hiddenMaterialIds: options.hiddenMaterialIds ?? [],
      sourceIdentity
    })
  }, [aggregates, selectedMaterialIds, sourceIdentity, viewState])

  const capturePascalScene = useCallback((
    width: number,
    height: number,
    timeoutMs: number
  ): Promise<Blob> => new Promise((resolve, reject) => {
    pendingPascalCapture.current?.reject(
      new Error('新的 3D 截图请求替代了尚未完成的请求')
    )
    if (pendingPascalCapture.current) {
      clearTimeout(pendingPascalCapture.current.timeout)
    }
    const timeout = setTimeout(() => {
      pendingPascalCapture.current = null
      reject(new Error(`Pascal 3D 截图在 ${timeoutMs}ms 内未完成`))
    }, timeoutMs)
    pendingPascalCapture.current = { resolve, reject, timeout }
    setPascalCaptureRequest(current => ({
      revision: (current?.revision ?? 0) + 1,
      width,
      height
    }))
  }), [])

  const handlePascalCaptureReady = useCallback((blob: Blob): void => {
    const pending = pendingPascalCapture.current
    if (!pending) return
    pendingPascalCapture.current = null
    clearTimeout(pending.timeout)
    pending.resolve(blob)
  }, [])

  const handleRendererRequest = useCallback(async (
    request: MaterialRendererRequest
  ): Promise<MaterialRendererResponse> => {
    if (request.kind === 'reload') {
      store.getState().reset()
      await store.getState().loadGraph()
      return {
        schemaVersion: MATERIAL_RENDERER_CONTRACT,
        requestId: request.requestId,
        ok: true,
        result: { status: 'reloaded' }
      }
    }
    if (request.kind === 'inspect') {
      return {
        schemaVersion: MATERIAL_RENDERER_CONTRACT,
        requestId: request.requestId,
        ok: true,
        result: await inspectScene(request.options)
      }
    }
    if (captureActive.current) {
      return rendererFailure(
        request.requestId,
        'material_renderer_busy',
        '物料画布正在完成另一个截图请求'
      )
    }
    captureActive.current = true
    setAutomationOptions(request.options)
    setAutomationRevision(revision => revision + 1)
    try {
      const root = rootRef.current
      if (!root) throw new Error('物料画布尚未挂载')
      await waitForMaterialScene(
        root,
        request.options.view ?? viewState.mode,
        request.options.timeoutMs ?? 30_000
      )
      const viewport = request.options.viewport
      const previousStyle = root.getAttribute('style')
      if (viewport) {
        // 并排 Workbench 中物料列可能只有百余像素。截图期间把同一 renderer
        // 提升为固定尺寸表面，使 Pascal 真正按请求分辨率重排，而不是放大小图。
        root.style.position = 'fixed'
        root.style.inset = '0 auto auto 0'
        root.style.zIndex = '2147483000'
        root.style.flex = 'none'
        root.style.background = '#ffffff'
        root.style.width = `${viewport.width}px`
        root.style.height = `${viewport.height}px`
        root.style.maxWidth = 'none'
        await stableAnimationFrames(5)
      }
      try {
        const view = request.options.view ?? viewState.mode
        const requestedWidth = viewport?.width ?? Math.round(root.clientWidth)
        const requestedHeight = viewport?.height ?? Math.round(root.clientHeight)
        const image = view === '3d'
          ? await capturePascalScene(
              requestedWidth,
              requestedHeight,
              Math.min(request.options.timeoutMs ?? 30_000, 8_000)
            ).catch(() => capturePascalCanvas(
              root,
              requestedWidth,
              requestedHeight
            )).then(async blob => ({
              base64: arrayBufferToBase64(await blob.arrayBuffer()),
              width: requestedWidth,
              height: requestedHeight
            }))
          : await captureMaterialDom(root, view, request.options).then(canvas => ({
              base64: canvas.toDataURL('image/png').split(',', 2)[1] ?? '',
              width: canvas.width,
              height: canvas.height
            }))
        const scene = await inspectScene(request.options)
        return {
          schemaVersion: MATERIAL_RENDERER_CONTRACT,
          requestId: request.requestId,
          ok: true,
          result: {
            schemaVersion: 'unilab-material-capture/v1',
            rendererVersion: 'unilab-workbench/0.1.0',
            scene,
            image: {
              mimeType: 'image/png',
              width: image.width,
              height: image.height,
              base64: image.base64
            }
          }
        }
      } finally {
        if (previousStyle == null) root.removeAttribute('style')
        else root.setAttribute('style', previousStyle)
      }
    } catch (cause) {
      return rendererFailure(
        request.requestId,
        'material_capture_failed',
        cause instanceof Error ? cause.message : String(cause)
      )
    } finally {
      setAutomationOptions(null)
      captureActive.current = false
    }
  }, [capturePascalScene, inspectScene, store, viewState.mode])

  useEffect(() => {
    const registration = sessionClient.setMaterialRendererHandler(
      handleRendererRequest
    )
    return () => registration.dispose()
  }, [handleRendererRequest, sessionClient])

  useWorkbenchMaterialGraphLoad(store, readStatus.available, loadState)

  /** 依次向 OS 提交物料移动，保留存储端的修订冲突语义。 */
  const applyMoves = useCallback(async (
    moves: readonly MaterialSceneMove[]
  ): Promise<void> => {
    for (const move of moves) {
      await store.getState().move(move.materialId, move.placement)
    }
  }, [store])

  /** 清理失败状态并重新读取当前调度权威的物料图。 */
  const retryGraph = useCallback((): void => {
    store.getState().reset()
    void store.getState().loadGraph()
  }, [store])

  if (!readStatus.available) {
    return <MaterialCapabilityNotice title="物料场景不可用" status={readStatus} />
  }
  if (loadState === 'idle' || loadState === 'loading') {
    return <div className="unilab-workbench-material-loading">正在加载物料场景…</div>
  }
  if (loadState === 'error') {
    return (
      <WorkbenchMaterialSceneState
        kind="error"
        error={graphError}
        onRetry={retryGraph}
      />
    )
  }
  if (sceneReadiness.state === 'empty') {
    return <WorkbenchMaterialSceneState kind="empty" readiness={sceneReadiness} />
  }
  if (sceneReadiness.state === 'list-only') {
    return (
      <WorkbenchMaterialSceneState
        kind="list-only"
        readiness={sceneReadiness}
      />
    )
  }

  return (
    <div
      ref={rootRef}
      className="unilab-workbench-material-scene"
      data-material-renderer-ready="true"
    >
      {shapeLibraryState === 'unavailable' && (
        displayedViewState.mode === '2.5d' || displayedViewState.mode === 'split'
      ) ? (
        <WorkbenchMaterialShapeFallbackNotice />
      ) : null}
      <UnifiedMaterialViewport
        viewState={displayedViewState}
        onViewStateChange={(next) => {
          setViewState(next)
          writeStoredMaterialViewportState(next)
        }}
        renderView={(viewMode, {
          showSites,
          showMaterialTransfers,
          showMaterialLabels
        }) => (
          <Suspense
            fallback={(
              <div className="unilab-workbench-material-loading">
                正在加载 {viewMode === '3d' || viewMode === 'split'
                  ? '3D'
                  : viewMode} 物料视图…
              </div>
            )}
          >
            <PascalLabWorkbench
              aggregates={displayedAggregates}
              shapes={shapeLibrary}
              showSites={showSites}
              showMaterialLabels={showMaterialLabels}
              showMaterialTransfers={showMaterialTransfers}
              materialTransferRoutes={materialTransferRoutes}
              materialTransferProjectionError={null}
              viewMode={viewMode}
              cameraPreset={automationOptions?.cameraPreset}
              cameraRequestRevision={automationRevision}
              cameraFocus={cameraFocus}
              captureRequest={pascalCaptureRequest}
              onCaptureReady={handlePascalCaptureReady}
              projectId={`unilab-workbench-${new URL(backendUrl).port}`}
              editable={moveStatus.available}
              selectedMaterialIds={displayedSelectedMaterialIds}
              highlightedMaterialIds={highlightedMaterialIds}
              modelRuntime={modelRuntime}
              onMaterialMoves={(moves) => void applyMoves(moves)}
              onSelectionChange={(materialIds) => onSelectionChange?.(materialIds)}
            />
          </Suspense>
        )}
      />
    </div>
  )
}

function applyLayoutOverrides(
  aggregates: readonly MaterialAggregate[],
  overrides: readonly MaterialRendererLayoutOverride[]
): MaterialAggregate[] {
  if (overrides.length === 0) return [...aggregates]
  const bySourceId = new Map(overrides.map(item => [item.sourceNodeId, item]))
  return aggregates.map(aggregate => {
    const sourceNodeId = aggregate.material.config.sourceIdentity
    const override = typeof sourceNodeId === 'string'
      ? bySourceId.get(sourceNodeId)
      : undefined
    if (!override) return aggregate
    const pose = aggregate.placement.kind === 'world'
      ? aggregate.placement.pose
      : aggregate.placement.kind === 'parent'
        ? aggregate.placement.localPose
        : null
    const placement = pose == null
      ? aggregate.placement
      : aggregate.placement.kind === 'world'
        ? {
            ...aggregate.placement,
            pose: {
              positionMm: override.positionMm ?? pose.positionMm,
              rotationDegXYZ: override.rotationDegXYZ ?? pose.rotationDegXYZ
            }
          }
        : {
            ...aggregate.placement,
            localPose: {
              positionMm: override.positionMm ?? pose.positionMm,
              rotationDegXYZ: override.rotationDegXYZ ?? pose.rotationDegXYZ
            }
          }
    const rendering = aggregate.material.config.rendering
    const config = override.assetRef
      ? {
          ...aggregate.material.config,
          rendering: {
            ...(rendering && typeof rendering === 'object' ? rendering : {}),
            model: override.assetRef
          }
        }
      : aggregate.material.config
    return {
      ...aggregate,
      material: { ...aggregate.material, config },
      placement
    }
  })
}

function rendererFailure(
  requestId: string,
  code: string,
  message: string
): MaterialRendererResponse {
  return {
    schemaVersion: MATERIAL_RENDERER_CONTRACT,
    requestId,
    ok: false,
    error: { code, message }
  }
}

async function waitForMaterialScene(
  root: HTMLElement,
  view: MaterialViewportState['mode'],
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const viewport = root.querySelector<HTMLElement>(
      '.lab-unified-viewport'
    )
    const pascal = root.querySelector<HTMLElement>('[data-pascal-scene-ready]')
    if (
      viewport?.dataset.labViewMode === view &&
      pascal?.dataset.pascalSceneReady === 'true'
    ) break
    await stableAnimationFrames(1)
  }
  if (Date.now() >= deadline) {
    throw new Error(`物料场景在 ${timeoutMs}ms 内未进入 ready`)
  }
  if (globalThis.document?.fonts) await globalThis.document.fonts.ready
  await waitForImages(root, deadline)
  const module = await import('@unilab/pascal-lab-plugin')
  let previousRevision = -1
  let stable = 0
  while (Date.now() < deadline && stable < 3) {
    const runtime = module.readMaterialSceneRuntimeState()
    const failures = Object.entries(runtime.modelFailures)
    if (failures.length > 0) {
      throw new Error(`3D 模型加载失败：${failures.map(
        ([identity, message]) => `${identity}: ${message}`
      ).join('；')}`)
    }
    stable = runtime.geometryRevision === previousRevision ? stable + 1 : 0
    previousRevision = runtime.geometryRevision
    await stableAnimationFrames(1)
  }
  if (stable < 3) throw new Error('物料场景几何在超时前仍未稳定')
}

async function waitForImages(root: HTMLElement, deadline: number): Promise<void> {
  const images = [...root.querySelectorAll('img')]
  for (const image of images) {
    while (!image.complete && Date.now() < deadline) {
      await stableAnimationFrames(1)
    }
    if (!image.complete || (image.src && image.naturalWidth === 0)) {
      throw new Error(`画布图片加载失败：${image.currentSrc || image.src}`)
    }
  }
}

function stableAnimationFrames(count: number): Promise<void> {
  return new Promise(resolve => {
    const next = (remaining: number): void => {
      if (remaining <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(() => next(remaining - 1))
    }
    next(count)
  })
}

async function captureMaterialDom(
  root: HTMLElement,
  view: Exclude<MaterialViewportState['mode'], '3d'>,
  options: MaterialRendererOptions
): Promise<HTMLCanvasElement> {
  const selector = view === '2.5d'
    ? '.pascal-lab-workbench__oblique'
    : view === '2d'
      ? '.material-canvas.is-floorplan-overlay'
      : '.pascal-editor-host'
  const target = root.querySelector<HTMLElement>(selector)
  if (!target) throw new Error(`${view} 物料画布尚未挂载`)
  const rect = target.getBoundingClientRect()
  const width = options.viewport?.width ?? Math.round(rect.width)
  const height = options.viewport?.height ?? Math.round(rect.height)
  const scale = options.viewport?.pixelRatio ?? 1
  const restoreSvgPresentation = inlineSvgPresentation(target)
  try {
    return await toCanvas(target, {
      width,
      height,
      canvasWidth: Math.round(width * scale),
      canvasHeight: Math.round(height * scale),
      pixelRatio: 1,
      backgroundColor: '#ffffff',
      cacheBust: true,
      skipAutoScale: true
    })
  } finally {
    restoreSvgPresentation()
  }
}

async function capturePascalCanvas(
  root: HTMLElement,
  width: number,
  height: number
): Promise<Blob> {
  await stableAnimationFrames(5)
  const source = root.querySelector<HTMLCanvasElement>('canvas')
  if (!source) throw new Error('Pascal 3D renderer 未提供可截图画布')
  const output = document.createElement('canvas')
  output.width = width
  output.height = height
  const context = output.getContext('2d')
  if (!context) throw new Error('浏览器不支持 3D 画布截图')
  context.drawImage(source, 0, 0, width, height)
  return new Promise((resolve, reject) => {
    output.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('Pascal 3D 画布未生成 PNG'))
    }, 'image/png')
  })
}

const SVG_PRESENTATION_PROPERTIES = [
  'color',
  'display',
  'dominant-baseline',
  'fill',
  'fill-opacity',
  'fill-rule',
  'flood-color',
  'flood-opacity',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'letter-spacing',
  'marker-end',
  'marker-mid',
  'marker-start',
  'opacity',
  'paint-order',
  'shape-rendering',
  'stop-color',
  'stop-opacity',
  'stroke',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-opacity',
  'stroke-width',
  'text-anchor',
  'text-rendering',
  'transform',
  'transform-origin',
  'visibility'
] as const

/**
 * SVG presentation rules can depend on a CSS-module scope outside the capture
 * target. Inline their computed values so the renderer clone keeps the exact
 * live material colours without retaining or parsing the whole Workbench DOM.
 */
function inlineSvgPresentation(root: HTMLElement): () => void {
  const elements = [...root.querySelectorAll<SVGElement>('svg, svg *')]
  const previousStyles = elements.map(element => element.getAttribute('style'))
  elements.forEach(element => {
    const computed = getComputedStyle(element)
    for (const property of SVG_PRESENTATION_PROPERTIES) {
      const value = computed.getPropertyValue(property)
      if (value) element.style.setProperty(property, value)
    }
  })
  return () => {
    elements.forEach((element, index) => {
      const previous = previousStyles[index]
      if (previous == null) element.removeAttribute('style')
      else element.setAttribute('style', previous)
    })
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return globalThis.btoa(binary)
}
