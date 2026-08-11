import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState, type ReactNode } from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { MaterialInstanceCreatePage } from './MaterialInstanceCreatePage'
import { MaterialInspector } from './MaterialInspector'
import { MaterialPlacementGuide } from './MaterialPlacementGuide'
import {
  useMaterialStore,
  useMaterialStoreApi
} from './MaterialStoreProvider'
import { MaterialTemplateLauncher } from './MaterialTemplateLauncher'
import { MaterialTreeSidebar } from './MaterialTreeSidebar'
import { MaterialTypeDraftPanel } from './MaterialTypeDraftPanel'
import { materialScopeClassName } from './materialStyles'
import { projectMaterialWorkspace } from './materialWorkspaceProjection'
import type {
  MaterialWorkspaceProjection,
  MaterialWorkspaceView
} from './materialWorkspaceProjection'
import {
  type MaterialInstanceCreateContext,
  MaterialWorkspaceHeader,
  MaterialWorkspacePanel
} from './MaterialWorkspaceViews'
import { MaterialCanvas } from './react-flow/MaterialCanvas'
import type {
  MaterialTemplateCatalogPort,
  MaterialTemplateDetail,
  MaterialTemplateKind,
  MaterialTemplateSummary,
  TemplateMaterialDraft
} from './templateMaterial'
import type {
  MaterialAggregate,
  MaterialId,
  MaterialScope,
  SiteId
} from './types'

export interface MaterialWorkbenchCapabilities {
  readTemplates: CapabilityStatus
  readGraph: CapabilityStatus
  create: CapabilityStatus
  updateConfig: CapabilityStatus
  deleteSubtrees?: CapabilityStatus
  move: CapabilityStatus
  attach?: CapabilityStatus
}

export interface MaterialWorkbenchProps {
  catalog: MaterialTemplateCatalogPort
  profileId: string
  scope: MaterialScope
  capabilities: MaterialWorkbenchCapabilities
  selectedMaterialIds?: readonly MaterialId[]
  highlightedMaterialIds?: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
  renderViewport?: (props: MaterialWorkbenchViewportProps) => ReactNode
  includeTemplate?: (template: MaterialTemplateSummary) => boolean
}

export interface MaterialWorkbenchViewportProps {
  readStatus: CapabilityStatus
  moveStatus: CapabilityStatus
  selectedMaterialIds: readonly MaterialId[]
  highlightedMaterialIds: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}

/**
 * 组合物料目录、画布、模板创建与属性维护工作台。
 * @param props 服务能力、物料范围、跨面板选择以及可选视口渲染器。
 * @returns 仅依赖物料服务端口的统一物料工作台。
 */
export function MaterialWorkbench({
  catalog,
  profileId,
  scope,
  capabilities,
  selectedMaterialIds = [],
  highlightedMaterialIds = [],
  onSelectionChange,
  renderViewport,
  includeTemplate
}: MaterialWorkbenchProps): React.JSX.Element {
  const [activeTemplateKind, setActiveTemplateKind] =
    useState<MaterialTemplateKind | null>(null)
  const [customTypeDraft, setCustomTypeDraft] = useState<{
    seedName?: string
  } | null>(null)
  const [instanceCreateContext, setInstanceCreateContext] =
    useState<MaterialInstanceCreateContext | null>(null)
  const [initialEditMaterialId, setInitialEditMaterialId] =
    useState<MaterialId | null>(null)
  const [placementMaterialId, setPlacementMaterialId] =
    useState<MaterialId | null>(null)
  const [activeView, setActiveView] = useState<MaterialWorkspaceView>('catalog')
  const store = useMaterialStoreApi()
  const aggregatesById = useMaterialStore(
    (state) => state.aggregatesById
  )
  const loadState = useMaterialStore((state) => state.loadState)
  const pendingCommandsById = useMaterialStore(
    (state) => state.pendingCommandsById
  )
  const existingNames = useMemo(
    () =>
      Object.values(aggregatesById)
        .filter(
          (aggregate) =>
            aggregate.material.component?.managedByParent !== true
        )
        .map((aggregate) => aggregate.material.name),
    [aggregatesById]
  )
  const inspectedMaterialId = selectedMaterialIds[0] ?? null
  const inspectedAggregate = inspectedMaterialId
    ? aggregatesById[inspectedMaterialId]
    : undefined
  const placementAggregate = placementMaterialId
    ? aggregatesById[placementMaterialId]
    : undefined
  const scopeKey =
    scope.kind === 'singleton' ? 'singleton' : scope.laboratoryId
  const inspectedTemplate = useQuery({
    queryKey: [
      'material-template',
      profileId,
      scopeKey,
      inspectedAggregate?.material.sourceTemplateId
    ],
    queryFn: () =>
      catalog.getTemplate(
        scope,
        inspectedAggregate?.material.sourceTemplateId ?? ''
      ),
    enabled:
      capabilities.readTemplates.available && Boolean(inspectedAggregate)
  })
  const placementTemplate = useQuery({
    queryKey: [
      'material-template',
      profileId,
      scopeKey,
      placementAggregate?.material.sourceTemplateId
    ],
    queryFn: () => catalog.getTemplate(
      scope,
      placementAggregate?.material.sourceTemplateId ?? ''
    ),
    enabled:
      capabilities.readTemplates.available && Boolean(placementAggregate)
  })
  const instanceCreateTemplate = useQuery({
    queryKey: [
      'material-template',
      profileId,
      scopeKey,
      instanceCreateContext?.templateId
    ],
    queryFn: () => catalog.getTemplate(
      scope,
      instanceCreateContext?.templateId ?? ''
    ),
    enabled:
      capabilities.readTemplates.available && Boolean(instanceCreateContext)
  })
  const templateCatalog = useQuery({
    queryKey: ['material-templates', profileId, scopeKey],
    queryFn: () => catalog.listTemplates(scope),
    enabled: capabilities.readTemplates.available
  })
  const visibleTemplates = useMemo(
    () => includeTemplate
      ? (templateCatalog.data?.items ?? []).filter(includeTemplate)
      : (templateCatalog.data?.items ?? []),
    [includeTemplate, templateCatalog.data?.items]
  )
  const workspaceProjection = useMemo(
    () => projectMaterialWorkspace(
      aggregatesById,
      visibleTemplates
    ),
    [aggregatesById, visibleTemplates]
  )
  const deleteStatus = capabilities.deleteSubtrees ?? {
    available: false,
    reason: '当前宿主未声明物料子树删除能力'
  }
  const attachStatus = capabilities.attach ?? {
    available: false,
    reason: '当前宿主未声明物料库位写入能力'
  }

  useEffect(() => {
    if (!capabilities.readGraph.available || loadState !== 'idle') return
    void store.getState().loadGraph().catch(() => undefined)
  }, [capabilities.readGraph.available, loadState, store])

  /**
   * 切换物料一级视图，并结束尚未提交的实例创建页面。
   * @param view 用户选择的目标物料视图。
   * @returns 无返回值。
   */
  const changeView = (view: MaterialWorkspaceView): void => {
    setCustomTypeDraft(null)
    setInstanceCreateContext(null)
    setActiveTemplateKind(null)
    setActiveView(view)
  }

  /**
   * 发布用户的普通物料选择，并结束仅用于创建后首次配置的编辑意图。
   * @param materialIds 当前界面选择的稳定物料身份。
   * @returns 无返回值。
   */
  const selectMaterials = (materialIds: readonly MaterialId[]): void => {
    setInitialEditMaterialId(null)
    onSelectionChange?.(materialIds)
  }

  /**
   * 打开继承当前资源模板和批次的物料实例创建页面。
   * @param context 当前目录选择的模板身份与可选批次。
   * @returns 无返回值。
   */
  const openInstanceCreatePage = (
    context: MaterialInstanceCreateContext
  ): void => {
    setInstanceCreateContext(context)
  }

  /**
   * 放弃当前物料实例草稿并返回物料管理目录。
   * @returns 无返回值。
   */
  const closeInstanceCreatePage = (): void => {
    setInstanceCreateContext(null)
  }

  /**
   * 结束自定义资源模板草稿页并返回物料管理目录的创建入口。
   * @returns 无返回值；不会提交或保留 ResourceTemplate 权威写入。
   */
  const closeCustomTypePage = (): void => {
    document.querySelector<HTMLButtonElement>('#material-tab-catalog')?.focus()
    setCustomTypeDraft(null)
  }

  /**
   * 通过物料图写端口创建实例，成功后选中新实例并直接进入参数配置。
   * @param draft 已通过名称校验并继承当前类型上下文的创建草稿。
   * @returns 服务端确认创建后结束；失败时由创建页面保留错误。
   */
  const createInstance = async (
    draft: TemplateMaterialDraft
  ): Promise<void> => {
    const result = await store.getState().createMaterial(draft.createInput)
    setInstanceCreateContext(null)
    setInitialEditMaterialId(result.primaryMaterialId)
    setPlacementMaterialId(result.primaryMaterialId)
    onSelectionChange?.([result.primaryMaterialId])
  }

  /**
   * 从实例概览继续到位置页，并保留待配置实例上下文。
   * @param materialId 待设置稳定库位的物料身份。
   * @returns 无返回值。
   */
  const openPlacement = (materialId: MaterialId): void => {
    setPlacementMaterialId(materialId)
    setInitialEditMaterialId(null)
    setActiveView('spatial')
    onSelectionChange?.([])
  }

  /**
   * 将当前位置页选择的稳定库位提交给共享 Material 图写端口。
   * @param parentId 提供库位的父 Material 身份。
   * @param siteId 用户选择的稳定 Site 身份。
   * @returns 附着命令完成后结束；不写入数量、预留或执行占用事实。
   */
  const attachPlacement = async (
    parentId: MaterialId,
    siteId?: SiteId
  ): Promise<void> => {
    if (!placementAggregate) return
    await store.getState().attach(
      parentId,
      placementAggregate.material.id,
      siteId
    )
  }

  return (
    <div className={materialScopeClassName('material-center')}>
      <MaterialWorkspaceHeader
        activeView={activeView}
        projection={workspaceProjection}
        loadState={loadState}
        readStatus={capabilities.readGraph}
        catalogStatus={capabilities.readTemplates}
        catalogLoadState={templateCatalog.isSuccess
          ? 'ready'
          : templateCatalog.isError
            ? 'error'
            : 'pending'}
        onViewChange={changeView}
      />
      <div className="material-center__body">
        {customTypeDraft ? (
          <MaterialTypeDraftPanel
            seedName={customTypeDraft.seedName}
            onClose={closeCustomTypePage}
          />
        ) : instanceCreateContext ? (
          <MaterialInstanceCreatePage
            key={[
              instanceCreateContext.templateId,
              instanceCreateContext.batch ?? '',
              instanceCreateTemplate.data?.contentHash ?? 'pending'
            ].join(':')}
            template={instanceCreateTemplate.data}
            loadState={instanceCreateTemplate.isError
              ? 'error'
              : instanceCreateTemplate.isSuccess
                ? 'ready'
                : 'pending'}
            initialBatch={instanceCreateContext.batch}
            existingNames={existingNames}
            createStatus={capabilities.create}
            onCancel={closeInstanceCreatePage}
            onCreate={createInstance}
          />
        ) : (
          <MaterialPrimaryWorkspace
            activeView={activeView}
            projection={workspaceProjection}
            selectedMaterialIds={selectedMaterialIds}
            highlightedMaterialIds={highlightedMaterialIds}
            capabilities={capabilities}
            renderViewport={renderViewport}
            placementAggregate={placementAggregate}
            aggregatesById={aggregatesById}
            placementTemplate={placementTemplate.data}
            placementTemplateLoadState={placementTemplate.isError
              ? 'error'
              : placementTemplate.isSuccess
                ? 'ready'
                : 'pending'}
            placementPending={Boolean(placementAggregate) &&
              Object.values(pendingCommandsById).some(
                (command) => command.materialIds.includes(
                  placementAggregate?.material.id ?? ''
                )
              )}
            attachStatus={attachStatus}
            onSelectionChange={selectMaterials}
            onRequestCreate={openInstanceCreatePage}
            onRequestCustomType={(seedName) => setCustomTypeDraft({ seedName })}
            onRequestTemplateCreate={() => setActiveTemplateKind('resource')}
            onAttachPlacement={attachPlacement}
            onClosePlacement={() => setPlacementMaterialId(null)}
          />
        )}
      </div>
      <MaterialTemplateLauncher
        catalog={catalog}
        profileId={profileId}
        scope={scope}
        readStatus={capabilities.readTemplates}
        createStatus={capabilities.create}
        existingNames={existingNames}
        activeKind={activeTemplateKind}
        showTabs={false}
        onActiveKindChange={setActiveTemplateKind}
        onCreate={async (_template, draft) => {
          await store.getState().createMaterial(draft.createInput)
        }}
      />
      {inspectedMaterialId ? (
        <MaterialInspector
          materialId={inspectedMaterialId}
          initialMode={
            initialEditMaterialId === inspectedMaterialId ? 'edit' : 'view'
          }
          configSchema={inspectedTemplate.data?.configuration.schema}
          updateStatus={capabilities.updateConfig}
          deleteStatus={deleteStatus}
          onRequestPlacement={() => openPlacement(inspectedMaterialId)}
          onClose={() => selectMaterials([])}
          onDeleted={() => selectMaterials([])}
        />
      ) : null}
    </div>
  )
}

interface MaterialPrimaryWorkspaceProps {
  activeView: MaterialWorkspaceView
  projection: MaterialWorkspaceProjection
  selectedMaterialIds: readonly MaterialId[]
  highlightedMaterialIds: readonly MaterialId[]
  capabilities: MaterialWorkbenchCapabilities
  renderViewport?: MaterialWorkbenchProps['renderViewport']
  placementAggregate?: MaterialAggregate
  aggregatesById: Readonly<Record<MaterialId, MaterialAggregate>>
  placementTemplate?: MaterialTemplateDetail
  placementTemplateLoadState: 'pending' | 'ready' | 'error'
  placementPending: boolean
  attachStatus: CapabilityStatus
  onSelectionChange: (materialIds: readonly MaterialId[]) => void
  onRequestCreate: (context: MaterialInstanceCreateContext) => void
  onRequestCustomType: (seedName?: string) => void
  onRequestTemplateCreate: () => void
  onAttachPlacement: (parentId: MaterialId, siteId?: SiteId) => Promise<void>
  onClosePlacement: () => void
}

/**
 * 在常规物料管理、当前位置和使用记录之间选择主视图。
 * @param props 物料投影、能力、选择状态、位置上下文与页面操作回调。
 * @returns 复用同一 Material 身份和图写端口的当前主视图。
 */
function MaterialPrimaryWorkspace({
  activeView,
  projection,
  selectedMaterialIds,
  highlightedMaterialIds,
  capabilities,
  renderViewport,
  placementAggregate,
  aggregatesById,
  placementTemplate,
  placementTemplateLoadState,
  placementPending,
  attachStatus,
  onSelectionChange,
  onRequestCreate,
  onRequestCustomType,
  onRequestTemplateCreate,
  onAttachPlacement,
  onClosePlacement
}: MaterialPrimaryWorkspaceProps): React.JSX.Element {
  if (activeView === 'spatial') {
    return (
      <section
        id="material-view-spatial"
        className="material-workbench"
        role="tabpanel"
        aria-labelledby="material-tab-spatial"
      >
        <MaterialTreeSidebar
          selectedMaterialIds={selectedMaterialIds}
          onSelectionChange={onSelectionChange}
          catalogStatus={capabilities.readTemplates}
          onRequestCreate={onRequestTemplateCreate}
        />
        <div className="material-workbench__viewport">
          {renderViewport ? (
            renderViewport({
              readStatus: capabilities.readGraph,
              moveStatus: capabilities.move,
              selectedMaterialIds,
              highlightedMaterialIds,
              onSelectionChange
            })
          ) : (
            <MaterialCanvas
              readStatus={capabilities.readGraph}
              moveStatus={capabilities.move}
              selectedMaterialIds={selectedMaterialIds}
              highlightedMaterialIds={highlightedMaterialIds}
              onSelectionChange={onSelectionChange}
            />
          )}
        </div>
        {placementAggregate ? (
          <MaterialPlacementGuide
            aggregate={placementAggregate}
            aggregatesById={aggregatesById}
            template={placementTemplate}
            templateLoadState={placementTemplateLoadState}
            attachStatus={attachStatus}
            pending={placementPending}
            onAttach={onAttachPlacement}
            onClose={onClosePlacement}
          />
        ) : null}
      </section>
    )
  }

  return (
    <MaterialWorkspacePanel
      view={activeView}
      projection={projection}
      selectedMaterialIds={selectedMaterialIds}
      onSelectionChange={onSelectionChange}
      onRequestCreate={onRequestCreate}
      onRequestCustomType={onRequestCustomType}
    />
  )
}
