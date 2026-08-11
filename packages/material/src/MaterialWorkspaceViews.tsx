import {
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent
} from 'react'

import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { materialScopeClassName } from './materialStyles'
import type {
  MaterialWorkspaceLotGroup,
  MaterialWorkspaceProjection,
  MaterialWorkspaceRow,
  MaterialWorkspaceTemplateGroup,
  MaterialWorkspaceView
} from './materialWorkspaceProjection'
import type { MaterialLoadState } from './storeTypes'
import type { MaterialId } from './types'
import { MaterialUsageHistoryView } from './MaterialWorkspaceBoundaryViews'
import {
  materialWorkspaceReadStatus,
  type MaterialCatalogLoadState
} from './materialWorkspaceStatus'

/**
 * THESIS: 物料管理只突出“物料类型—物料批次—物料实例”的稳定下钻路径。
 * OWN-WORLD: 继承 Uni-Lab 精密操作台，以冷灰工作区、白色表面和物料紫表达选择。
 * STORY: 用户先找到资源模板，再缩小到批次，最后操作具有稳定 UUID 的物料实例。
 * FIRST VIEWPORT: 页头给出单行范围摘要，主体同时呈现类型、批次和实例三段工作区。
 * FORM: 已有产品世界内的高密度主从工作台；移动端保持同一结构并逐级下钻。
 * FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
 */

const VIEW_OPTIONS: readonly {
  id: MaterialWorkspaceView
  label: string
}[] = [
  {
    id: 'catalog',
    label: '物料管理'
  },
  {
    id: 'spatial',
    label: '位置'
  },
  {
    id: 'history',
    label: '使用记录'
  }
]

export interface MaterialWorkspaceHeaderProps {
  activeView: MaterialWorkspaceView
  projection: MaterialWorkspaceProjection
  loadState: MaterialLoadState
  readStatus: CapabilityStatus
  catalogStatus: CapabilityStatus
  catalogLoadState: MaterialCatalogLoadState
  onViewChange: (view: MaterialWorkspaceView) => void
}

/**
 * 展示物料模块范围、权威读取状态、层级摘要和一级视图导航。
 * @param props 页头所需的读取状态、投影摘要与视图切换回调。
 * @returns 物料模块的紧凑页头与一级导航。
 */
export function MaterialWorkspaceHeader({
  activeView,
  projection,
  loadState,
  readStatus,
  catalogStatus,
  catalogLoadState,
  onViewChange
}: MaterialWorkspaceHeaderProps): React.JSX.Element {
  const status = materialWorkspaceReadStatus(
    loadState,
    readStatus,
    catalogStatus,
    catalogLoadState
  )
  const summary = projection.summary
  return (
    <>
      <header className="material-center__header">
        <div className="material-center__identity">
          <div>
            <h2>物料</h2>
            <p>按类型、批次和实例管理实验室物料。</p>
          </div>
          <span
            className="material-center__authority"
            data-state={status.state}
            role="status"
          >
            <span aria-hidden="true" />
            {status.label}
          </span>
        </div>

        <dl className="material-center__summary" aria-label="物料管理摘要">
          <div>
            <dt>物料类型</dt>
            <dd>{summary.resourceTemplateCount}</dd>
          </div>
          <div>
            <dt>批次</dt>
            <dd>{summary.batchGroupCount}</dd>
          </div>
          <div>
            <dt>物料实例</dt>
            <dd>{summary.trackedInstanceCount}</dd>
          </div>
          <div>
            <dt>已放置</dt>
            <dd>
              {summary.placedInstanceCount}
              <small> / {summary.trackedInstanceCount}</small>
            </dd>
          </div>
        </dl>
      </header>

      <nav
        className="material-center__views"
        role="tablist"
        aria-label="物料管理视图"
        aria-orientation="horizontal"
      >
        {VIEW_OPTIONS.map((view) => (
          <button
            key={view.id}
            type="button"
            role="tab"
            id={`material-tab-${view.id}`}
            aria-selected={activeView === view.id}
            aria-controls={`material-view-${view.id}`}
            tabIndex={activeView === view.id ? 0 : -1}
            className={activeView === view.id ? 'is-active' : undefined}
            onClick={() => onViewChange(view.id)}
            onKeyDown={(event) => handleViewNavigation(
              event,
              view.id,
              onViewChange
            )}
          >
            <strong>{view.label}</strong>
          </button>
        ))}
      </nav>
    </>
  )
}

/**
 * 为一级视图页签提供方向键、Home 与 End 键盘导航。
 * @param event 当前页签的键盘事件。
 * @param currentView 当前激活的物料视图。
 * @param onViewChange 视图切换回调。
 * @returns 无返回值。
 */
function handleViewNavigation(
  event: KeyboardEvent<HTMLButtonElement>,
  currentView: MaterialWorkspaceView,
  onViewChange: (view: MaterialWorkspaceView) => void
): void {
  const currentIndex = VIEW_OPTIONS.findIndex((view) => view.id === currentView)
  const targetIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? VIEW_OPTIONS.length - 1
      : event.key === 'ArrowRight'
        ? (currentIndex + 1) % VIEW_OPTIONS.length
        : event.key === 'ArrowLeft'
          ? (currentIndex - 1 + VIEW_OPTIONS.length) % VIEW_OPTIONS.length
          : null
  if (targetIndex === null) return

  event.preventDefault()
  const targetView = VIEW_OPTIONS[targetIndex]
  if (!targetView) return
  onViewChange(targetView.id)
  const tabs = event.currentTarget.parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  tabs?.[targetIndex]?.focus()
}

export interface MaterialWorkspacePanelProps {
  view: Exclude<MaterialWorkspaceView, 'spatial'>
  projection: MaterialWorkspaceProjection
  selectedMaterialIds: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
  onRequestCreate: (context: MaterialInstanceCreateContext) => void
  onRequestCustomType: (seedName?: string) => void
}

export interface MaterialInstanceCreateContext {
  templateId: string
  batch?: string
}

/**
 * 渲染物料层级或使用记录边界。
 * @param props 当前非空间视图、层级投影及操作回调。
 * @returns 对应的物料管理内容面板。
 */
export function MaterialWorkspacePanel({
  view,
  projection,
  selectedMaterialIds,
  onSelectionChange,
  onRequestCreate,
  onRequestCustomType
}: MaterialWorkspacePanelProps): React.JSX.Element {
  if (view === 'catalog') {
    return (
      <MaterialCatalogView
        projection={projection}
        selectedMaterialIds={selectedMaterialIds}
        onSelectionChange={onSelectionChange}
        onRequestCreate={onRequestCreate}
        onRequestCustomType={onRequestCustomType}
      />
    )
  }
  return <MaterialUsageHistoryView />
}

type MobileCatalogStage = 'templates' | 'batches' | 'instances'

/**
 * 以资源模板、兼容批次分组、物料实例三层主从结构组织物料管理。
 * @param props 物料投影、实例选择状态与创建操作回调。
 * @returns 类型、批次和实例组成的主从工作区。
 */
function MaterialCatalogView({
  projection,
  selectedMaterialIds,
  onSelectionChange,
  onRequestCreate,
  onRequestCustomType
}: {
  projection: MaterialWorkspaceProjection
  selectedMaterialIds: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
  onRequestCreate: (context: MaterialInstanceCreateContext) => void
  onRequestCustomType: (seedName?: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    projection.templates[0]?.template.uuid ?? null
  )
  const [selectedBatchKey, setSelectedBatchKey] = useState<string | null>(null)
  const [mobileStage, setMobileStage] = useState<MobileCatalogStage>('templates')
  const filteredTemplates = useMemo(
    () => filterMaterialTemplateGroups(projection.templates, query),
    [projection.templates, query]
  )
  const selectedTemplate = filteredTemplates.find(
    (group) => group.template.uuid === selectedTemplateId
  ) ?? filteredTemplates[0] ?? null
  const selectedBatch = selectedTemplate?.batches.find(
    (batch) => batch.key === selectedBatchKey
  ) ?? selectedTemplate?.batches[0] ?? null

  /**
   * 以当前物料类型和兼容批次投影打开实例创建页面。
   * @returns 无返回值；没有选中物料类型时不发起页面切换。
   */
  const requestCreateInstance = (): void => {
    if (!selectedTemplate) return
    onRequestCreate({
      templateId: selectedTemplate.template.uuid,
      ...(selectedBatch?.batch ? { batch: selectedBatch.batch } : {})
    })
  }

  useEffect(() => {
    if (!selectedTemplate) return
    if (selectedTemplate.template.uuid !== selectedTemplateId) {
      setSelectedTemplateId(selectedTemplate.template.uuid)
      setSelectedBatchKey(selectedTemplate.batches[0]?.key ?? null)
    }
  }, [selectedTemplate, selectedTemplateId])

  const selectTemplate = (group: MaterialWorkspaceTemplateGroup): void => {
    setSelectedTemplateId(group.template.uuid)
    setSelectedBatchKey(group.batches[0]?.key ?? null)
    setMobileStage('batches')
  }
  const selectBatch = (batch: MaterialWorkspaceLotGroup): void => {
    setSelectedBatchKey(batch.key)
    setMobileStage('instances')
  }

  return (
    <section
      id="material-view-catalog"
      className={materialScopeClassName('material-catalog')}
      role="tabpanel"
      aria-labelledby="material-tab-catalog"
      aria-label="物料管理"
      data-mobile-stage={mobileStage}
    >
      <header className="material-catalog__toolbar">
        <div className="material-catalog__flow-path" aria-label="当前物料层级">
          <strong>物料类型</strong>
          <span aria-hidden="true">›</span>
          <span>{selectedTemplate?.template.displayName ?? '选择类型'}</span>
          <span aria-hidden="true">›</span>
          <span>{selectedBatch ? batchLabel(selectedBatch) : '选择批次'}</span>
        </div>
        <label className="material-catalog__search">
          <SearchIcon />
          <input
            type="search"
            value={query}
            aria-label="搜索物料类型"
            placeholder="搜索物料类型或实例"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      </header>

      <nav className="material-catalog__mobile-path" aria-label="物料层级">
        <button type="button" onClick={() => setMobileStage('templates')}>
          类型
        </button>
        <span aria-hidden="true">›</span>
        <button
          type="button"
          disabled={!selectedTemplate}
          onClick={() => setMobileStage('batches')}
        >
          {selectedTemplate?.template.displayName ?? '批次'}
        </button>
        <span aria-hidden="true">›</span>
        <button
          type="button"
          disabled={!selectedBatch}
          onClick={() => setMobileStage('instances')}
        >
          {batchLabel(selectedBatch)}
        </button>
      </nav>

      <div className="material-catalog__workspace">
        <aside className="material-catalog__templates" data-catalog-panel="templates">
          <div className="material-catalog__section-title">
            <span>物料类型</span>
            <small>{filteredTemplates.length} 种类型</small>
          </div>
          {filteredTemplates.length ? (
            <>
              <ul>
                {filteredTemplates.map((group) => (
                  <li key={group.template.uuid}>
                    <button
                      type="button"
                      aria-current={
                        selectedTemplate?.template.uuid === group.template.uuid ||
                        undefined
                      }
                      onClick={() => selectTemplate(group)}
                    >
                      <span className="material-catalog__template-mark" aria-hidden="true">
                        <LabwareIcon />
                      </span>
                      <span className="material-catalog__template-copy">
                        <strong>{group.template.displayName}</strong>
                        <small>{templateMeta(group)}</small>
                      </span>
                      <span className="material-catalog__template-count">
                        <strong>{group.rows.length}</strong>
                        <small>实例</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="material-catalog__new-type"
                onClick={() => onRequestCustomType()}
              >
                ＋ 新建物料类型
              </button>
            </>
          ) : (
            <CatalogEmptyState
              title="没有匹配的物料类型"
              detail="调整搜索条件，或创建一个自定义物料类型。"
              action="创建自定义类型"
              onAction={onRequestCustomType}
            />
          )}
        </aside>

        <section className="material-catalog__batches" data-catalog-panel="batches">
          {selectedTemplate ? (
            <>
              <button
                type="button"
                className="material-catalog__mobile-back"
                onClick={() => setMobileStage('templates')}
              >
                ← 返回物料类型
              </button>
              <header className="material-catalog__type-header">
                <div>
                  <h4>物料批次</h4>
                  <p>
                    {selectedTemplate.template.displayName} ·{' '}
                    {categoryLabel(selectedTemplate)} ·{' '}
                    {structureLabel(selectedTemplate)}
                  </p>
                </div>
                <button type="button" onClick={requestCreateInstance}>
                  ＋ 新建实例
                </button>
              </header>
              {selectedTemplate.batches.length ? (
                <ul className="material-catalog__batch-list">
                  {selectedTemplate.batches.map((batch) => (
                    <li key={batch.key}>
                      <button
                        type="button"
                        aria-current={selectedBatch?.key === batch.key || undefined}
                        onClick={() => selectBatch(batch)}
                      >
                        <span className="material-catalog__batch-symbol" aria-hidden="true">
                          <BatchIcon />
                        </span>
                        <span>
                          <strong>{batchLabel(batch)}</strong>
                          <small>
                            {batch.rows.length} 个实例 · {batch.placedCount} 个已放置
                          </small>
                        </span>
                        <span aria-hidden="true">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <CatalogEmptyState
                  title="这个类型还没有实例"
                  detail="从该资源模板创建实例后，批次和实例会显示在这里。"
                  action="创建第一个实例"
                  onAction={requestCreateInstance}
                />
              )}

              <button
                type="button"
                className="material-catalog__configure-type"
                onClick={() => onRequestCustomType(
                  selectedTemplate.template.displayName
                )}
              >
                <SettingsIcon />
                <span>
                  <strong>复制为自定义类型</strong>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            </>
          ) : null}
        </section>

        <section className="material-catalog__instances" data-catalog-panel="instances">
          {selectedTemplate && selectedBatch ? (
            <>
              <button
                type="button"
                className="material-catalog__mobile-back"
                onClick={() => setMobileStage('batches')}
              >
                ← 返回物料批次
              </button>
              <header className="material-catalog__instances-header">
                <div>
                  <h4>物料实例</h4>
                  <p>
                    {selectedTemplate.template.displayName} / {batchLabel(selectedBatch)} ·{' '}
                    {selectedBatch.rows.length} 个实例 · {selectedBatch.placedCount} 个已放置
                  </p>
                </div>
              </header>
              <MaterialInstanceTable
                rows={selectedBatch.rows}
                selectedMaterialIds={selectedMaterialIds}
                onSelectionChange={onSelectionChange}
              />
              <footer className="material-catalog__authority-note">
                <InfoIcon />
                <span>
                  批次信息暂从物料实例配置读取；厂家批号、有效期和质检状态将在物料批次服务接入后统一维护。
                </span>
              </footer>
            </>
          ) : selectedTemplate ? (
            <CatalogEmptyState
              title="等待物料实例"
              detail="选择批次后查看具体物料，或从当前模板创建一个实例。"
              action="从模板创建"
              onAction={requestCreateInstance}
            />
          ) : (
            <CatalogEmptyState
              title="选择物料类型"
              detail="先从左侧资源模板目录选择一种物料。"
            />
          )}
        </section>
      </div>
    </section>
  )
}

/**
 * 展示当前批次中的稳定物料实例，不把登记状态解释为库存可用。
 * @param props 当前批次实例、选择状态与选择回调。
 * @returns 可选择具体物料实例的台账表格。
 */
function MaterialInstanceTable({
  rows,
  selectedMaterialIds,
  onSelectionChange
}: {
  rows: readonly MaterialWorkspaceRow[]
  selectedMaterialIds: readonly MaterialId[]
  onSelectionChange?: (materialIds: readonly MaterialId[]) => void
}): React.JSX.Element {
  const selected = new Set(selectedMaterialIds)
  return (
    <div className="material-catalog__instance-table-wrap">
      <table className="material-catalog__instance-table">
        <thead>
          <tr>
            <th>物料实例</th>
            <th>当前位置</th>
            <th>内部结构</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} aria-selected={selected.has(row.id)}>
              <td data-label="物料实例">
                <button
                  type="button"
                  onClick={() => onSelectionChange?.([row.id])}
                >
                  <span className="material-catalog__instance-mark" aria-hidden="true">
                    <InstanceIcon />
                  </span>
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.code} · {shortIdentity(row.id)}</small>
                  </span>
                </button>
              </td>
              <td data-label="当前位置">
                <span className={row.placed ? 'is-placed' : 'is-unplaced'}>
                  {row.placementLabel}
                </span>
              </td>
              <td data-label="内部结构">
                {row.internalContainerCount
                  ? `${row.internalContainerCount} 个容器位`
                  : '无'}
              </td>
              <td data-label="状态">
                <span className="material-catalog__registered-state">已登记</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CatalogEmptyState({
  title,
  detail,
  action,
  onAction
}: {
  title: string
  detail: string
  action?: string
  onAction?: () => void
}): React.JSX.Element {
  return (
    <div className="material-catalog__empty" role="status">
      <span aria-hidden="true"><EmptyBoxIcon /></span>
      <strong>{title}</strong>
      <small>{detail}</small>
      {action && onAction ? (
        <button type="button" onClick={onAction}>{action}</button>
      ) : null}
    </div>
  )
}

/** 按用户查询筛选实例台账，不改变原有业务排序。 */
export function filterMaterialWorkspaceRows(
  rows: readonly MaterialWorkspaceRow[],
  query: string
): readonly MaterialWorkspaceRow[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return rows
  return rows.filter((row) => (
    `${row.name} ${row.code} ${row.id} ${row.templateName} ` +
    `${row.templateId} ${row.batch ?? ''} ${row.placementLabel}`
  ).toLocaleLowerCase().includes(normalized))
}

/** 按类型身份、标签及实例内容筛选资源模板目录。 */
export function filterMaterialTemplateGroups(
  groups: readonly MaterialWorkspaceTemplateGroup[],
  query: string
): readonly MaterialWorkspaceTemplateGroup[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return groups
  return groups.filter((group) => {
    const template = group.template
    const templateText = [
      template.displayName,
      template.key,
      template.description ?? '',
      ...template.tags,
      ...template.categoryPath
    ].join(' ')
    return templateText.toLocaleLowerCase().includes(normalized) ||
      filterMaterialWorkspaceRows(group.rows, normalized).length > 0
  })
}

function templateMeta(group: MaterialWorkspaceTemplateGroup): string {
  const tags = group.template.tags.slice(0, 2).join(' · ')
  return tags || group.template.sourceNamespace
}

function categoryLabel(group: MaterialWorkspaceTemplateGroup): string {
  return group.template.categoryPath.join(' / ') || '未分类'
}

/**
 * 汇总所选物料类型中实例的最大内部容器位数量。
 * @param group 当前物料类型及其实例投影。
 * @returns 面向批次栏摘要的简短容器位说明。
 */
function structureLabel(group: MaterialWorkspaceTemplateGroup): string {
  const count = Math.max(
    0,
    ...group.rows.map((row) => row.internalContainerCount)
  )
  return count ? `${count} 个容器位` : '无容器位'
}

function batchLabel(batch: MaterialWorkspaceLotGroup | null): string {
  return batch?.batch ?? (batch ? '未分批实例' : '实例')
}

/** 将稳定 UUID 或代码压缩为适合实例台账辅助列的文本。 */
function shortIdentity(value: string): string {
  if (value.length <= 18) return value
  return `${value.slice(0, 8)}…${value.slice(-6)}`
}

function SearchIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <circle cx="8" cy="8" r="4.75" />
      <path d="m11.5 11.5 3.5 3.5" />
    </svg>
  )
}

function LabwareIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M4 6h16v12H4z" />
      <path d="M7 9h2m3 0h2m3 0h1M7 13h2m3 0h2m3 0h1" />
    </svg>
  )
}

function BatchIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 7.5 12 4l7 3.5-7 3.5-7-3.5Z" />
      <path d="M5 7.5v5l7 3.5 7-3.5v-5M5 12.5v4l7 3.5 7-3.5v-4" />
    </svg>
  )
}

function InstanceIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <path d="M6 8h8M6 11h5" />
    </svg>
  )
}

function SettingsIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M4 5h12M4 10h12M4 15h12" />
      <circle cx="8" cy="5" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <circle cx="7" cy="15" r="1.5" />
    </svg>
  )
}

function InfoIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="6.5" />
      <path d="M9 8v4M9 5.5v.25" />
    </svg>
  )
}

function EmptyBoxIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m4 8 8-4 8 4-8 4-8-4Z" />
      <path d="M4 8v8l8 4 8-4V8M12 12v8" />
    </svg>
  )
}
