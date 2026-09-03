import type { WorkflowActionCatalogSnapshot } from '@unilab/services'
import { useMemo, useState } from 'react'

import { WorkflowButton } from './WorkflowButton'
import {
  ExperimentOperationDeviceCatalog,
  useExperimentOperationDeviceCatalog
} from './ExperimentOperationDeviceCatalog'
import {
  writeWorkflowNodePaletteDragPayload,
  type WorkflowNodePaletteDragPayload
} from '../utils/workflowCanvasCommands'

export type WorkflowNodePaletteKind =
  | 'all'
  | 'material'
  | 'action'
  | 'workflow'

export interface WorkflowNodePaletteProps {
  catalog: WorkflowActionCatalogSnapshot | null
  catalogError?: string | null
  busy: boolean
  canvasMutationEnabled: boolean
  graphAvailable: boolean
  materialSourceCatalogAvailable: boolean
  materialSourceAuthorityBlocked: boolean
  materialSourceCatalogLoading: boolean
  materialSourceCatalogError: string | null
  onAddMaterialSource: () => void
  onAddAction: (templateUuid: string) => void
  onAddWorkflow: (templateUuid: string) => void
  onRefreshMaterialSourceCatalog: () => void | Promise<void>
  onPaletteDragStart?: (payload: WorkflowNodePaletteDragPayload) => void
}

interface WorkflowNodePaletteProjection {
  actions: WorkflowActionCatalogSnapshot['actionTemplates']
  workflows: WorkflowActionCatalogSnapshot['workflowTemplates']
  showMaterial: boolean
  totalCount: number
  counts: Readonly<Record<WorkflowNodePaletteKind, number>>
}

const PALETTE_KINDS: ReadonlyArray<{
  value: WorkflowNodePaletteKind
  label: string
}> = [
  { value: 'all', label: '全部' },
  { value: 'material', label: '物料' },
  { value: 'action', label: '操作' },
  { value: 'workflow', label: '子工作流' }
]

/**
 * 按节点类型和关键词投影工作流（Workflow）节点库。
 *
 * @param catalog OS 返回的可执行模板目录。
 * @param query 用户输入的名称、类型或来源关键词。
 * @param kind 当前选中的节点分类。
 * @returns 保留原始模板身份的可见节点与分类数量。
 */
export function workflowNodePaletteProjection(
  catalog: WorkflowActionCatalogSnapshot | null,
  query: string,
  kind: WorkflowNodePaletteKind,
  materialTemplateAvailable = true
): WorkflowNodePaletteProjection {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const matches = (...values: Array<string | null | undefined>): boolean => (
    !normalizedQuery || values.some((value) =>
      value?.toLocaleLowerCase().includes(normalizedQuery)
    )
  )
  const allActions = catalog?.actionTemplates ?? []
  const allWorkflows = catalog?.workflowTemplates ?? []
  const actions = kind === 'all' || kind === 'action'
    ? allActions.filter((template) => matches(
        template.displayName,
        template.name,
        template.actionType,
        template.actionClass
      ))
    : []
  const workflows = kind === 'all' || kind === 'workflow'
    ? allWorkflows.filter((template) => matches(
        template.displayName,
        template.name,
        template.source.symbol,
        template.source.module
      ))
    : []
  const showMaterial = materialTemplateAvailable &&
    (kind === 'all' || kind === 'material') && matches(
      '物料来源',
      'OS 准入声明',
      'material source',
      'site'
    )
  const materialCount = materialTemplateAvailable ? 1 : 0
  const counts = {
    all: allActions.length + allWorkflows.length + materialCount,
    material: materialCount,
    action: allActions.length,
    workflow: allWorkflows.length
  }
  return {
    actions,
    workflows,
    showMaterial,
    totalCount: actions.length + workflows.length + (showMaterial ? 1 : 0),
    counts
  }
}

/**
 * 提供可搜索、可分类的工作流（Workflow）节点插入入口。
 *
 * @param props 模板目录、编辑权限、物料来源目录状态与插入回调。
 * @returns 不改变 OS 模板身份的紧凑节点库。
 */
export function WorkflowNodePalette({
  catalog,
  catalogError = null,
  busy,
  canvasMutationEnabled,
  graphAvailable,
  materialSourceCatalogAvailable,
  materialSourceAuthorityBlocked,
  materialSourceCatalogLoading,
  materialSourceCatalogError,
  onAddMaterialSource,
  onAddAction,
  onAddWorkflow,
  onRefreshMaterialSourceCatalog,
  onPaletteDragStart
}: WorkflowNodePaletteProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<WorkflowNodePaletteKind>('all')
  const projection = useMemo(
    () => workflowNodePaletteProjection(
      catalog,
      query,
      kind,
      materialSourceCatalogAvailable
    ),
    [catalog, kind, materialSourceCatalogAvailable, query]
  )
  const templateDisabled = busy || !canvasMutationEnabled || !graphAvailable
  const templateDisabledReason = busy
    ? '正在处理工作流，请稍后添加节点'
    : !canvasMutationEnabled
      ? '当前模式只允许查看工作流画布'
      : '工作流图尚未加载完成'
  const startTemplateDrag = (
    event: React.DragEvent<HTMLButtonElement>,
    payload: WorkflowNodePaletteDragPayload,
    disabled: boolean
  ): void => {
    if (disabled) {
      event.preventDefault()
      return
    }
    writeWorkflowNodePaletteDragPayload(event.dataTransfer, payload)
  }

  return (
    <aside
      id="persistent-authoring-node-palette"
      className="persistent-authoring__palette"
      aria-label="工作流（Workflow）节点库"
    >
      <WorkflowNodePaletteHeader
        query={query}
        templateCount={projection.counts.all}
        onQueryChange={setQuery}
      />

      <div
        className="persistent-authoring__palette-kinds"
        role="group"
        aria-label="节点模板分类"
      >
        {PALETTE_KINDS.filter((option) =>
          option.value === 'all' || projection.counts[option.value] > 0
        ).map((option) => (
          <button
            key={option.value}
            type="button"
            className={kind === option.value ? 'is-active' : undefined}
            aria-pressed={kind === option.value}
            onClick={() => setKind(option.value)}
          >
            {option.label}
            <small>{projection.counts[option.value]}</small>
          </button>
        ))}
      </div>

      <div className="persistent-authoring__palette-scroll">
        {catalogError && (
          <div className="persistent-authoring__palette-problem" role="alert">
            <p>{catalogError}；正在自动重试</p>
          </div>
        )}
        {projection.showMaterial && (
          <section aria-label="物料来源（MaterialSource）模板">
            <h3>物料</h3>
            <WorkflowButton
              type="button"
              className="persistent-authoring__palette-source"
              disabled={
                busy ||
                !canvasMutationEnabled ||
                !materialSourceCatalogAvailable ||
                materialSourceAuthorityBlocked
              }
              disabledReason={busy
                ? '正在处理工作流，请稍后添加物料来源'
                : !canvasMutationEnabled
                  ? '当前模式只允许查看工作流画布'
                  : materialSourceAuthorityBlocked
                    ? '物料来源目录或引用已失效，请先刷新'
                    : '物料与库位目录尚未加载完成'}
              draggable={
                !busy &&
                canvasMutationEnabled &&
                materialSourceCatalogAvailable &&
                !materialSourceAuthorityBlocked
              }
              onDragStart={(event) => startTemplateDrag(
                event,
                { kind: 'material' },
                busy ||
                !canvasMutationEnabled ||
                !materialSourceCatalogAvailable ||
                materialSourceAuthorityBlocked
              )}
              onClick={onAddMaterialSource}
            >
              <span aria-hidden="true">▱</span>
              <span>
                <strong>物料来源</strong>
                <small>OS 准入声明</small>
              </span>
            </WorkflowButton>
            {materialSourceCatalogLoading && (
              <p role="status">正在读取物料与库位目录…</p>
            )}
            {materialSourceCatalogError && (
              <div className="persistent-authoring__palette-problem">
                <p>{materialSourceCatalogError}</p>
                <button
                  type="button"
                  onClick={() => void onRefreshMaterialSourceCatalog()}
                >
                  重新读取
                </button>
              </div>
            )}
          </section>
        )}

        <WorkflowActionPaletteSection
          kind={kind}
          query={query}
          templates={catalog?.actionTemplates ?? []}
          visibleTemplates={projection.actions}
          disabled={templateDisabled}
          disabledReason={templateDisabledReason}
          onAddAction={onAddAction}
          onStartDrag={startTemplateDrag}
          onPaletteDragStart={onPaletteDragStart}
        />

        {projection.workflows.length > 0 && (
          <section aria-label="子工作流（Workflow）模板">
            <h3>子工作流</h3>
            <div className="persistent-authoring__palette-actions">
              {projection.workflows.map((template) => (
                <WorkflowButton
                  type="button"
                  key={template.uuid}
                  disabled={templateDisabled}
                  disabledReason={templateDisabledReason}
                  draggable={!templateDisabled}
                  onDragStart={(event) => startTemplateDrag(
                    event,
                    { kind: 'workflow', templateUuid: template.uuid },
                    templateDisabled
                  )}
                  onClick={() => onAddWorkflow(template.uuid)}
                >
                  <span aria-hidden="true">▣</span>
                  <span>
                    <strong>{template.displayName}</strong>
                    <small>{template.source.symbol}</small>
                  </span>
                </WorkflowButton>
              ))}
            </div>
          </section>
        )}

        <WorkflowNodePaletteEmpty
          totalCount={projection.totalCount}
          kind={kind}
          query={query}
          onClearQuery={() => setQuery('')}
        />
      </div>
    </aside>
  )
}

function WorkflowNodePaletteHeader({
  query,
  templateCount,
  onQueryChange
}: {
  query: string
  templateCount: number
  onQueryChange(query: string): void
}): React.JSX.Element {
  const operationDeviceCatalog = useExperimentOperationDeviceCatalog()
  const reportedActionCount = operationDeviceCatalog?.devices.reduce(
    (total, device) => total + device.actions.length,
    0
  ) ?? 0
  return (
    <header>
      <span>
        <strong>{operationDeviceCatalog ? '操作与节点库' : '节点库'}</strong>
        <small>{operationDeviceCatalog
          ? `${operationDeviceCatalog.devices.length} 台 · ${reportedActionCount} 项`
          : `${templateCount} 个可用模板`}</small>
      </span>
      <label className="persistent-authoring__palette-search">
        <span className="sr-only">搜索节点模板</span>
        <input
          type="search"
          value={query}
          placeholder="搜索名称或类型"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
    </header>
  )
}

function WorkflowActionPaletteSection({
  kind,
  query,
  templates,
  visibleTemplates,
  disabled,
  disabledReason,
  onAddAction,
  onStartDrag,
  onPaletteDragStart
}: {
  kind: WorkflowNodePaletteKind
  query: string
  templates: WorkflowActionCatalogSnapshot['actionTemplates']
  visibleTemplates: WorkflowActionCatalogSnapshot['actionTemplates']
  disabled: boolean
  disabledReason: string
  onAddAction(templateUuid: string): void
  onStartDrag(
    event: React.DragEvent<HTMLButtonElement>,
    payload: WorkflowNodePaletteDragPayload,
    disabled: boolean
  ): void
  onPaletteDragStart?: (payload: WorkflowNodePaletteDragPayload) => void
}): React.JSX.Element | null {
  const operationDeviceCatalog = useExperimentOperationDeviceCatalog()
  if (operationDeviceCatalog && (kind === 'all' || kind === 'action')) {
    return (
      <ExperimentOperationDeviceCatalog
        devices={operationDeviceCatalog.devices}
        templates={templates}
        query={query}
        loading={operationDeviceCatalog.loading}
        error={operationDeviceCatalog.error}
        disabled={disabled}
        disabledReason={disabledReason}
        onRefresh={operationDeviceCatalog.refresh}
        onAddAction={onAddAction}
        onPaletteDragStart={onPaletteDragStart}
      />
    )
  }
  if (visibleTemplates.length === 0) return null
  return (
    <section aria-label="动作（Action）模板">
      <h3>操作</h3>
      <div className="persistent-authoring__palette-actions">
        {visibleTemplates.map(template => (
          <WorkflowButton
            type="button"
            key={template.uuid}
            disabled={disabled}
            disabledReason={disabledReason}
            data-workflow-palette-action={template.uuid}
            draggable={!disabled && !onPaletteDragStart}
            onDragStart={(event) => onStartDrag(
              event,
              { kind: 'action', templateUuid: template.uuid },
              disabled
            )}
            onPointerDown={(event) => {
              if (disabled || !onPaletteDragStart) return
              event.currentTarget.setPointerCapture?.(event.pointerId)
              onPaletteDragStart({
                kind: 'action',
                templateUuid: template.uuid
              })
            }}
          >
            <span aria-hidden="true">⌁</span>
            <span>
              <strong>{template.displayName}</strong>
              <small>{template.name}</small>
            </span>
          </WorkflowButton>
        ))}
      </div>
    </section>
  )
}

function WorkflowNodePaletteEmpty({
  totalCount,
  kind,
  query,
  onClearQuery
}: {
  totalCount: number
  kind: WorkflowNodePaletteKind
  query: string
  onClearQuery(): void
}): React.JSX.Element | null {
  const operationDeviceCatalog = useExperimentOperationDeviceCatalog()
  if (totalCount > 0) return null
  if (
    operationDeviceCatalog &&
    (kind === 'all' || kind === 'action') &&
    (operationDeviceCatalog.loading || operationDeviceCatalog.devices.length > 0)
  ) return null
  return (
    <div className="persistent-authoring__palette-empty" role="status">
      <strong>没有匹配的节点模板</strong>
      <span>尝试搜索名称、类型或切换分类。</span>
      {query && (
        <button type="button" onClick={onClearQuery}>
          清除搜索
        </button>
      )}
    </div>
  )
}
