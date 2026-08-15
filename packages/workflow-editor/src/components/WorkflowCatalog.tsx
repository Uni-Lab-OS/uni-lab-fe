import { useEffect, useMemo, useState } from 'react'

import type {
  CapabilityStatus,
  WorkflowRuntimePort,
  WorkflowSummary
} from '@unilab/services'

import {
  DeleteWorkflowDialog,
  CreateWorkflowDialog,
  WorkflowChangeLogDialog
} from './WorkflowCatalogDialogs'
import { WorkflowCatalogCard } from './WorkflowCatalogCard'
import styles from './workflow.module.scss'

/** 修改日志与删除能力暂不向工作流目录开放。 */
export const WORKFLOW_CATALOG_MANAGEMENT_ACTIONS_VISIBLE = false

/** 新建能力保留在底层，目录入口暂不向用户展示。 */
export const WORKFLOW_CATALOG_CREATION_ENTRY_VISIBLE = false

/** 目录范围与状态筛选暂不向用户展示，只保留关键词搜索。 */
export const WORKFLOW_CATALOG_FILTER_CONTROLS_VISIBLE = false

export interface WorkflowCatalogState {
  status: 'loading' | 'ready' | 'error'
  summary: string
  technicalDetail?: string
}

export function WorkflowCatalog({
  runtime,
  activeWorkflowStorageKey,
  recoveryRevision,
  authoringStatus,
  runStatus,
  onStateChange,
  onSelect
}: {
  runtime: WorkflowRuntimePort
  activeWorkflowStorageKey?: string
  recoveryRevision: number
  authoringStatus?: CapabilityStatus
  runStatus?: CapabilityStatus
  onStateChange?: (state: WorkflowCatalogState) => void
  onSelect?: (workflowUuid: string, workflowName: string) => void
}): React.JSX.Element {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [requestRevision, setRequestRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [catalogView, setCatalogView] = useState<'all' | 'recent'>('all')
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'configured' | 'empty'
  >('all')
  const [recentWorkflowIds, setRecentWorkflowIds] = useState<string[]>(() =>
    readRecentWorkflowIds(activeWorkflowStorageKey)
  )
  const [createOpen, setCreateOpen] = useState(false)
  const [deleteWorkflow, setDeleteWorkflow] = useState<WorkflowSummary | null>(null)
  const [logWorkflow, setLogWorkflow] = useState<WorkflowSummary | null>(null)
  const selectionMode = workflowCatalogSelectionMode(authoringStatus, runStatus)
  const authoringAvailable = selectionMode === 'authoring'

  useEffect(() => {
    let disposed = false
    setLoading(true)
    setError(null)
    onStateChange?.({ status: 'loading', summary: '正在读取工作流目录' })
    void runtime.listWorkflows({ page: 1, page_size: 100 })
      .then((page) => {
        if (!disposed) {
          setWorkflows(page.items)
          onStateChange?.({
            status: 'ready',
            summary: `${page.items.length} 个工作流`
          })
        }
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          const technicalDetail = reason instanceof Error
            ? reason.message
            : String(reason)
          setError(technicalDetail)
          onStateChange?.({
            status: 'error',
            summary: '工作流目录不可用',
            technicalDetail
          })
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [onStateChange, recoveryRevision, requestRevision, runtime])

  const recentWorkflows = useMemo(() => {
    const byId = new Map(workflows.map((workflow) => [workflow.uuid, workflow]))
    return recentWorkflowIds.flatMap((workflowUuid) => {
      const workflow = byId.get(workflowUuid)
      return workflow ? [workflow] : []
    })
  }, [recentWorkflowIds, workflows])
  const filteredWorkflows = useMemo(() => {
    const source = catalogView === 'recent' ? recentWorkflows : workflows
    const normalizedQuery = query.trim().toLocaleLowerCase()
    return source.filter((workflow) => {
      const matchesStatus = statusFilter === 'all' ||
        workflow.definition_status === statusFilter
      if (!matchesStatus) return false
      if (!normalizedQuery) return true
      return [workflow.name, workflow.description ?? '', ...workflow.tags]
        .some((value) => value.toLocaleLowerCase().includes(normalizedQuery))
    })
  }, [catalogView, query, recentWorkflows, statusFilter, workflows])
  const groupedWorkflows = useMemo(
    () => groupWorkflowCatalog(filteredWorkflows),
    [filteredWorkflows]
  )

  /** 记录最近使用并打开选中的工作流。 */
  const handleSelect = (workflowUuid: string, workflowName = ''): void => {
    if (!onSelect) return
    const nextRecent = recordRecentWorkflowId(
      activeWorkflowStorageKey,
      recentWorkflowIds,
      workflowUuid
    )
    setRecentWorkflowIds(nextRecent)
    onSelect(
      workflowUuid,
      workflowName || workflows.find((item) => item.uuid === workflowUuid)?.name || ''
    )
  }

  /** 创建工作流后刷新目录并直接进入新的编排上下文。 */
  const handleCreate = async (
    request: Parameters<WorkflowRuntimePort['createWorkflowDefinition']>[0]
  ): Promise<void> => {
    const created = await runtime.createWorkflowDefinition(request)
    setCreateOpen(false)
    setWorkflows((current) => [created, ...current])
    handleSelect(created.uuid, created.name)
  }

  /** 删除工作流后立即移出目录，再以 OS 结果触发一次完整复原。 */
  const handleDelete = async (workflow: WorkflowSummary): Promise<void> => {
    await runtime.deleteWorkflowDefinition(workflow.uuid)
    setDeleteWorkflow(null)
    setWorkflows((current) => current.filter((item) => item.uuid !== workflow.uuid))
    setRecentWorkflowIds((current) => current.filter((id) => id !== workflow.uuid))
    setRequestRevision((value) => value + 1)
  }

  return (
    <div
      className={[
        styles.workflow,
        'workflow-runtime workflow-runtime__catalog',
        'relative flex h-full w-full flex-col',
        'bg-[var(--unilab-color-canvas)] text-[var(--unilab-color-text)]'
      ].join(' ')}
    >
      <header className="workflow-runtime__catalog-header">
        <div>
          <h2>工作流目录</h2>
          <p>
            {workflowCatalogIntroduction(selectionMode)}
          </p>
          {!selectionMode && (runStatus?.reason ?? authoringStatus?.reason) ? (
            <small title={runStatus?.reason ?? authoringStatus?.reason}>
              {runStatus?.reason ?? authoringStatus?.reason}
            </small>
          ) : null}
        </div>
        <div className="workflow-runtime__catalog-header-actions">
          {WORKFLOW_CATALOG_CREATION_ENTRY_VISIBLE && authoringAvailable ? (
            <button type="button" onClick={() => setCreateOpen(true)}>
              <span aria-hidden="true">＋</span>
              新建工作流
            </button>
          ) : null}
        </div>
      </header>

      {!loading && !error && workflows.length > 0 ? (
        <div className="workflow-runtime__catalog-tools">
          <label>
            <span className="workflow-runtime__visually-hidden">搜索工作流</span>
            <input
              type="search"
              value={query}
              placeholder="搜索名称、描述或标签"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {WORKFLOW_CATALOG_FILTER_CONTROLS_VISIBLE ? (
            <>
              <div role="group" aria-label="工作流目录范围">
                <button
                  type="button"
                  aria-pressed={catalogView === 'all'}
                  onClick={() => setCatalogView('all')}
                >
                  全部
                </button>
                <button
                  type="button"
                  aria-pressed={catalogView === 'recent'}
                  onClick={() => setCatalogView('recent')}
                >
                  最近使用{recentWorkflows.length > 0 ? ` ${recentWorkflows.length}` : ''}
                </button>
              </div>
              <label className="workflow-runtime__catalog-status-filter">
                <span className="workflow-runtime__visually-hidden">按状态筛选</span>
                <select
                  value={statusFilter}
                  aria-label="按工作流状态筛选"
                  onChange={(event) => setStatusFilter(
                    event.target.value as typeof statusFilter
                  )}
                >
                  <option value="all">全部状态</option>
                  <option value="configured">已配置</option>
                  <option value="empty">待编排</option>
                </select>
              </label>
            </>
          ) : null}
          <span role="status">{filteredWorkflows.length} 个结果</span>
        </div>
      ) : null}

      {loading ? (
        <div className="workflow-runtime__catalog-state" role="status">
          正在读取工作流…
        </div>
      ) : null}
      {!loading && error ? (
        <div className="workflow-runtime__catalog-state is-error" role="alert">
          <strong>工作流读取失败</strong>
          <span>未能从当前后端读取目录。请确认服务正常运行后重试。</span>
          <button type="button" onClick={() => setRequestRevision((value) => value + 1)}>
            重试
          </button>
          <details>
            <summary>查看技术信息</summary>
            <code>{error}</code>
          </details>
        </div>
      ) : null}
      {!loading && !error && workflows.length === 0 ? (
        <div className="workflow-runtime__catalog-state" role="status">
          <strong>当前后端还没有工作流</strong>
          <span>{workflowCatalogEmptyMessage(selectionMode)}</span>
          {WORKFLOW_CATALOG_CREATION_ENTRY_VISIBLE && authoringAvailable ? (
            <button type="button" onClick={() => setCreateOpen(true)}>
              新建工作流
            </button>
          ) : null}
        </div>
      ) : null}
      {!loading && !error && workflows.length > 0 && filteredWorkflows.length === 0 ? (
        <div className="workflow-runtime__catalog-state" role="status">
          {catalogView === 'recent' && recentWorkflows.length === 0
            ? '尚无最近使用的工作流'
            : '没有符合当前搜索与筛选条件的工作流'}
        </div>
      ) : null}
      {!loading && !error && groupedWorkflows.length > 0 ? (
        <div className="workflow-runtime__catalog-groups">
          {groupedWorkflows.map((group) => {
            const headingId = `workflow-catalog-${slugify(group.label)}`
            return (
              <section key={group.label} aria-labelledby={headingId}>
                <header>
                  <h3 id={headingId}>{group.label}</h3>
                  <span>{group.workflows.length}</span>
                </header>
                <div className="workflow-runtime__catalog-list" role="list">
                  {group.workflows.map((workflow) => (
                    <WorkflowCatalogCard
                      key={workflow.uuid}
                      workflow={workflow}
                      selectionMode={onSelect ? selectionMode : null}
                      manageable={authoringAvailable}
                      managementActionsVisible={WORKFLOW_CATALOG_MANAGEMENT_ACTIONS_VISIBLE}
                      disabledReason={runStatus?.reason ?? authoringStatus?.reason ??
                        '当前 Backend 只提供只读工作流目录'}
                      onOpen={() => handleSelect(workflow.uuid, workflow.name)}
                      onShowLog={() => setLogWorkflow(workflow)}
                      onDelete={() => setDeleteWorkflow(workflow)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : null}

      {createOpen ? (
        <CreateWorkflowDialog
          onCancel={() => setCreateOpen(false)}
          onCreate={handleCreate}
        />
      ) : null}
      {WORKFLOW_CATALOG_MANAGEMENT_ACTIONS_VISIBLE && deleteWorkflow ? (
        <DeleteWorkflowDialog
          workflow={deleteWorkflow}
          onCancel={() => setDeleteWorkflow(null)}
          onDelete={() => handleDelete(deleteWorkflow)}
        />
      ) : null}
      {WORKFLOW_CATALOG_MANAGEMENT_ACTIONS_VISIBLE && logWorkflow ? (
        <WorkflowChangeLogDialog
          workflow={logWorkflow}
          onClose={() => setLogWorkflow(null)}
          loadChanges={async () => (
            await runtime.listWorkflowDefinitionChanges(logWorkflow.uuid)
          ).items}
        />
      ) : null}
    </div>
  )
}

export interface WorkflowCatalogGroup {
  label: string
  workflows: WorkflowSummary[]
}

/** 按工位、用途与未分类顺序组织工作流目录。 */
export function groupWorkflowCatalog(
  workflows: readonly WorkflowSummary[]
): WorkflowCatalogGroup[] {
  const groups = new Map<string, WorkflowSummary[]>()
  for (const workflow of workflows) {
    const label = workflowGroupLabel(workflow)
    const current = groups.get(label) ?? []
    current.push(workflow)
    groups.set(label, current)
  }
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const rankDifference = workflowGroupRank(left) - workflowGroupRank(right)
      return rankDifference || left.localeCompare(right, 'zh-CN')
    })
    .map(([label, items]) => ({
      label,
      workflows: items.sort((left, right) =>
        right.update_time.localeCompare(left.update_time)
      )
    }))
}

/** 返回分组标题的稳定排序权重。 */
function workflowGroupRank(label: string): number {
  if (/^S\d{2} 工位$/.test(label)) return 0
  if (label.startsWith('用途 · ')) return 1
  return 2
}

/** 从名称或标签推导工作流目录分组。 */
export function workflowGroupLabel(workflow: WorkflowSummary): string {
  const station = [workflow.name, ...workflow.tags]
    .join(' ')
    .match(/(?:^|[^a-z0-9])(s\d{2})(?:[^a-z0-9]|$)/i)?.[1]
  if (station) return `${station.toUpperCase()} 工位`
  const purpose = workflow.tags.find((tag) => tag.trim())?.trim()
  return purpose ? `用途 · ${purpose}` : '未分类'
}

/** 从本地偏好读取最近打开的工作流身份。 */
function readRecentWorkflowIds(storageKey?: string): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(recentStorageKey(storageKey))
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed?.workflowIds)
      ? parsed.workflowIds.filter((value: unknown) => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

/** 记录最近打开的工作流，并限制为六项本地效率偏好。 */
function recordRecentWorkflowId(
  storageKey: string | undefined,
  current: readonly string[],
  workflowUuid: string
): string[] {
  const next = [workflowUuid, ...current.filter((id) => id !== workflowUuid)]
    .slice(0, 6)
  try {
    globalThis.localStorage?.setItem(
      recentStorageKey(storageKey),
      JSON.stringify({ version: 1, workflowIds: next })
    )
  } catch {
    // 最近使用仅是本地目录效率偏好，不影响 OS 中的工作流事实。
  }
  return next
}

/** 生成不同工作台实例互不干扰的最近使用存储键。 */
function recentStorageKey(activeWorkflowStorageKey?: string): string {
  return `${activeWorkflowStorageKey ?? 'unilab.workflow.active'}.recent.v1`
}

type WorkflowCatalogSelectionMode = 'authoring' | 'run' | null

/** 按 capability 决定目录卡片进入创作、已有工作流运行或只读模式。 */
function workflowCatalogSelectionMode(
  authoringStatus: CapabilityStatus | undefined,
  runStatus: CapabilityStatus | undefined
): WorkflowCatalogSelectionMode {
  if (authoringStatus?.available !== false) return 'authoring'
  return runStatus?.available === true ? 'run' : null
}

function workflowCatalogIntroduction(mode: WorkflowCatalogSelectionMode): string {
  if (mode === 'authoring') return '查找、创建并管理当前 OS 中的工作流定义'
  if (mode === 'run') return '选择 Backend 中已有的工作流并启动任务；工作流创作未启用'
  return '当前 Backend 提供只读目录；工作流创作与运行尚未启用'
}

function workflowCatalogEmptyMessage(mode: WorkflowCatalogSelectionMode): string {
  if (mode === 'authoring') return '新建工作流后即可开始编排。'
  if (mode === 'run') return '请先在 Backend 中导入或写入演示工作流数据。'
  return '请在支持工作流创作的 OS 中创建定义。'
}

/** 生成用于 aria 标题关联的稳定 DOM 片段。 */
function slugify(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/gu, '-')
}
