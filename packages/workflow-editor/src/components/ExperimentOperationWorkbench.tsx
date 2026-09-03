import type {
  CapabilityStatus,
  DeviceActionDeclarationDevice,
  ExperimentOperationCreateRequest,
  WorkflowActionCatalogSnapshot,
  WorkflowRuntimePort,
  WorkflowSummary
} from '@unilab/services'
import { workflowDefinitionKind } from '@unilab/services'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { WorkflowTracePort } from '../traceRuntime'
import type { WorkflowPanelRuntimeProjection } from '../workflowPanelProjection'
import type {
  WorkflowResourceSlotOptionsPort
} from '../utils/workflowResourceSlotOptions'
import { CreateExperimentOperationDialog } from './CreateExperimentOperationDialog'
import {
  ExperimentOperationDeviceCatalogProvider,
  type ExperimentOperationDeviceCatalogPort
} from './ExperimentOperationDeviceCatalog'
import { ExperimentOperationDeviceLibrary } from './ExperimentOperationDeviceLibrary'
import { PersistentWorkflowAuthoringPanel } from './PersistentWorkflowAuthoringPanel'
import { WorkflowButton } from './WorkflowButton'
import './ExperimentOperation.module.scss'
import workflowStyles from './workflow.module.scss'

export interface ExperimentOperationWorkbenchProps {
  runtime: WorkflowRuntimePort
  deviceCatalogPort?: ExperimentOperationDeviceCatalogPort
  catalogStatus: CapabilityStatus
  creationStatus?: CapabilityStatus
  /** @deprecated 使用 creationStatus。保留该入口以兼容现有宿主与测试。 */
  authoringStatus?: CapabilityStatus
  active: boolean
  recoveryRevision?: number
  traceRuntime?: WorkflowTracePort
  resourceSlotOptionsPort?: WorkflowResourceSlotOptionsPort
  executionStatus?: CapabilityStatus
  onUnsavedChangesChange?: (hasUnsavedChanges: boolean) => void
  onWorkflowRuntimeProjectionChange?: (
    projection: WorkflowPanelRuntimeProjection | null
  ) => void
  onSelectedWorkflowStepChange?: (workflowNodeUuid: string | null) => void
  hideEmbeddedCodeEditor?: boolean
}

/** Keep only definitions explicitly classified by OS as experiment operations. */
export function filterExperimentOperationDefinitions(
  summaries: readonly WorkflowSummary[]
): WorkflowSummary[] {
  return summaries
    .filter(summary => workflowDefinitionKind(summary) === 'operation')
    .sort((left, right) => right.update_time.localeCompare(left.update_time))
}

/**
 * 实验操作调试入口。目录由 OS 权威定义元数据驱动，编辑复用同一个 Canonical
 * Definition authoring 会话、X6 画布、双 CAS 保存和 WorkflowTask 调试链路。
 */
export function ExperimentOperationWorkbench({
  runtime,
  deviceCatalogPort,
  catalogStatus,
  creationStatus,
  authoringStatus,
  active,
  recoveryRevision = 0,
  traceRuntime,
  resourceSlotOptionsPort,
  executionStatus,
  onUnsavedChangesChange,
  onWorkflowRuntimeProjectionChange,
  onSelectedWorkflowStepChange,
  hideEmbeddedCodeEditor = false
}: ExperimentOperationWorkbenchProps): React.JSX.Element {
  const [operations, setOperations] = useState<WorkflowSummary[]>([])
  const [selectedOperationUuid, setSelectedOperationUuid] = useState<
    string | null
  >(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionCatalog, setActionCatalog] =
    useState<WorkflowActionCatalogSnapshot | null>(null)
  const [actionCatalogLoading, setActionCatalogLoading] = useState(false)
  const [actionCatalogError, setActionCatalogError] = useState<string | null>(null)
  const [devices, setDevices] = useState<DeviceActionDeclarationDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [authoringDirty, setAuthoringDirty] = useState(false)
  const [requestRevision, setRequestRevision] = useState(0)

  const effectiveCreationStatus = creationStatus
    ?? authoringStatus
    ?? catalogStatus

  const refreshDirectory = useCallback((): void => {
    setRequestRevision(value => value + 1)
  }, [])

  useEffect(() => {
    if (!active) return
    if (!catalogStatus.available) {
      setLoading(false)
      setOperations([])
      setSelectedOperationUuid(null)
      setError(catalogStatus.reason ?? '当前 Authority 不支持读取实验操作目录')
      return
    }
    let disposed = false
    setLoading(true)
    setError(null)
    void runtime.listWorkflows({ page: 1, page_size: 100 })
      .then(page => {
        if (disposed) return
        const next = filterExperimentOperationDefinitions(page.items)
        setOperations(next)
        setSelectedOperationUuid(current =>
          current && next.some(item => item.uuid === current)
            ? current
            : next[0]?.uuid ?? null
        )
      })
      .catch((reason: unknown) => {
        if (disposed) return
        setOperations([])
        setSelectedOperationUuid(null)
        setError(errorMessage(reason))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [
    active,
    catalogStatus.available,
    catalogStatus.reason,
    recoveryRevision,
    requestRevision,
    runtime
  ])

  useEffect(() => {
    if (!active) return
    if (!catalogStatus.available) {
      setActionCatalog(null)
      setActionCatalogLoading(false)
      setActionCatalogError(
        catalogStatus.reason ?? '当前 Authority 不支持读取设备动作目录'
      )
      return
    }
    const controller = new AbortController()
    setActionCatalogLoading(true)
    setActionCatalogError(null)
    void runtime.getWorkflowActionCatalog(controller.signal)
      .then(catalog => {
        if (!controller.signal.aborted) setActionCatalog(catalog)
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setActionCatalog(null)
        setActionCatalogError(errorMessage(reason))
      })
      .finally(() => {
        if (!controller.signal.aborted) setActionCatalogLoading(false)
      })
    return () => controller.abort()
  }, [
    active,
    catalogStatus.available,
    catalogStatus.reason,
    recoveryRevision,
    requestRevision,
    runtime
  ])

  useEffect(() => {
    if (!active) return
    if (!deviceCatalogPort) {
      setDevices([])
      setDevicesLoading(false)
      setDevicesError(null)
      return
    }
    const controller = new AbortController()
    let disposed = false
    setDevicesLoading(true)
    setDevicesError(null)
    void deviceCatalogPort.getDeviceActionDeclarations(controller.signal)
      .then(nextDevices => {
        if (!disposed) setDevices(nextDevices)
      })
      .catch((reason: unknown) => {
        if (disposed || controller.signal.aborted) return
        setDevices([])
        setDevicesError(`设备动作目录加载失败：${errorMessage(reason)}`)
      })
      .finally(() => {
        if (!disposed) setDevicesLoading(false)
      })
    return () => {
      disposed = true
      controller.abort()
    }
  }, [active, deviceCatalogPort, recoveryRevision, requestRevision])

  const selectedOperation = useMemo(
    () => operations.find(item => item.uuid === selectedOperationUuid) ?? null,
    [operations, selectedOperationUuid]
  )
  const categorySuggestions = useMemo(
    () => Array.from(new Set(
      operations.flatMap(operation => operation.tags)
        .map(category => category.trim())
        .filter(Boolean)
    )).sort((left, right) => left.localeCompare(right, 'zh-CN')),
    [operations]
  )
  const createDisabledReason = !effectiveCreationStatus.available
    ? effectiveCreationStatus.reason ?? '当前 Authority 不支持创建实验操作'
    : authoringDirty
      ? '请先保存当前实验操作的修改'
      : loading
        ? '实验操作目录正在刷新'
        : null

  const handleCreate = useCallback(async (
    request: ExperimentOperationCreateRequest
  ): Promise<void> => {
    const created = await runtime.createExperimentOperation(request)
    setOperations(current => [
      created,
      ...current.filter(operation => operation.uuid !== created.uuid)
    ])
    setSelectedOperationUuid(created.uuid)
    setAuthoringDirty(false)
    setCreateOpen(false)
    setError(null)
  }, [runtime])

  const deviceCatalogState = useMemo(() => ({
    devices,
    loading: devicesLoading,
    error: devicesError,
    refresh: refreshDirectory
  }), [devices, devicesError, devicesLoading, refreshDirectory])

  if (!active) {
    return (
      <section
        className={`${workflowStyles.workflow} experiment-operation`}
        data-definition-kind="operation"
        data-experiment-operation-state="inactive"
        aria-label="实验操作调试工作台"
      >
        <div className="experiment-operation__directory-state" role="status">
          <span className="codicon codicon-type-hierarchy" aria-hidden="true" />
          <strong>实验操作目录</strong>
          <p>进入实验操作调试后读取 OS 权威目录。</p>
        </div>
      </section>
    )
  }

  return (
    <ExperimentOperationDeviceCatalogProvider value={deviceCatalogState}>
      <section
        className={`${workflowStyles.workflow} experiment-operation experiment-operation--persistent`}
        data-definition-kind="operation"
        data-experiment-operation-state={selectedOperation ? 'authoring' : 'catalog'}
        data-visual-baseline="workflow-x6"
        aria-label="实验操作调试工作台"
      >
        <header className="experiment-operation__page-header">
          <div>
            <h1>实验操作调试</h1>
            <p>编排设备动作、配置操作参数并进行单操作调试。</p>
          </div>
          <WorkflowButton
            type="button"
            className="experiment-operation__page-create"
            disabled={createDisabledReason !== null}
            disabledReason={createDisabledReason ?? '创建实验操作'}
            onClick={() => setCreateOpen(true)}
          >
            <span className="codicon codicon-add" aria-hidden="true" />
            新建实验操作
          </WorkflowButton>
        </header>

        {!selectedOperation ? (
          <ExperimentOperationEmptyWorkbench
            catalog={actionCatalog}
            catalogLoading={actionCatalogLoading}
            catalogError={actionCatalogError}
            directoryLoading={loading}
            directoryError={error}
            canCreate={createDisabledReason === null}
            createDisabledReason={createDisabledReason ?? undefined}
            onCreate={() => setCreateOpen(true)}
            onRefresh={refreshDirectory}
          />
        ) : (
          <div className="experiment-operation__persistent-workbench">
            <PersistentWorkflowAuthoringPanel
              key={selectedOperation.uuid}
              runtime={runtime}
              definitionAuthority="workspace"
              definitionEditingStatus={{ available: true }}
              definitionKind="operation"
              initialMode="canvas"
              workflowUuid={selectedOperation.uuid}
              workflowName={selectedOperation.name}
              traceRuntime={traceRuntime}
              resourceSlotOptionsPort={resourceSlotOptionsPort}
              executionStatus={executionStatus}
              onUnsavedChangesChange={(hasUnsavedChanges) => {
                setAuthoringDirty(hasUnsavedChanges)
                onUnsavedChangesChange?.(hasUnsavedChanges)
              }}
              onWorkflowRuntimeProjectionChange={
                onWorkflowRuntimeProjectionChange
              }
              onSelectedWorkflowStepChange={onSelectedWorkflowStepChange}
              recoveryRevision={recoveryRevision}
              hideEmbeddedCodeEditor={hideEmbeddedCodeEditor}
              hideAuthoringToolbar
              onSelectWorkflow={(workflowUuid) => {
                if (operations.some(item => item.uuid === workflowUuid)) {
                  setSelectedOperationUuid(workflowUuid)
                }
              }}
            />
          </div>
        )}
        {createOpen ? (
          <CreateExperimentOperationDialog
            categorySuggestions={categorySuggestions}
            onCancel={() => setCreateOpen(false)}
            onCreate={handleCreate}
          />
        ) : null}
      </section>
    </ExperimentOperationDeviceCatalogProvider>
  )
}

function ExperimentOperationEmptyWorkbench({
  catalog,
  catalogLoading,
  catalogError,
  directoryLoading,
  directoryError,
  canCreate,
  createDisabledReason,
  onCreate,
  onRefresh
}: {
  catalog: WorkflowActionCatalogSnapshot | null
  catalogLoading: boolean
  catalogError: string | null
  directoryLoading: boolean
  directoryError: string | null
  canCreate: boolean
  createDisabledReason?: string
  onCreate: () => void
  onRefresh: () => void
}): React.JSX.Element {
  const [libraryTab, setLibraryTab] =
    useState<'operation' | 'device-action'>('device-action')

  return (
    <div className="experiment-operation__empty-workbench">
      <aside className="experiment-operation__empty-library">
        <header><h2>操作与节点库</h2></header>
        <div className="experiment-operation__empty-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={libraryTab === 'operation'}
            className={libraryTab === 'operation' ? 'is-active' : undefined}
            onClick={() => setLibraryTab('operation')}
          >
            实验操作库
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={libraryTab === 'device-action'}
            className={libraryTab === 'device-action' ? 'is-active' : undefined}
            onClick={() => setLibraryTab('device-action')}
          >
            设备动作库
          </button>
        </div>
        {libraryTab === 'device-action' ? (
          <ExperimentOperationDeviceLibrary
            catalog={catalog}
            loading={catalogLoading}
            error={catalogError}
            dragEnabled={false}
            disabled={!canCreate}
            disabledReason={createDisabledReason ?? '请先新建实验操作'}
            onAddAction={canCreate ? () => onCreate() : undefined}
            onRefresh={onRefresh}
          />
        ) : (
          <div className="experiment-operation__empty-operation-list">
            <label>
              <span className="codicon codicon-search" aria-hidden="true" />
              <input type="search" placeholder="搜索操作名称 / 编号" disabled />
            </label>
            <div role={directoryError ? 'alert' : 'status'}>
              <span
                className={`codicon ${directoryError
                  ? 'codicon-warning'
                  : directoryLoading
                    ? 'codicon-loading codicon-modifier-spin'
                    : 'codicon-type-hierarchy-sub'}`}
                aria-hidden="true"
              />
              <strong>{directoryError
                ? '实验操作目录读取失败'
                : directoryLoading ? '正在读取实验操作' : '尚未创建实验操作'}</strong>
              <small>{directoryError ?? '新建后将在这里显示并进入画布。'}</small>
              {directoryError ? (
                <button type="button" onClick={onRefresh}>重新读取</button>
              ) : (
                <WorkflowButton
                  type="button"
                  disabled={!canCreate}
                  disabledReason={createDisabledReason ?? '当前 Authority 不支持新建实验操作'}
                  onClick={onCreate}
                >
                  新建实验操作
                </WorkflowButton>
              )}
            </div>
          </div>
        )}
      </aside>

      <aside className="experiment-operation__empty-structure">
        <header><strong>实验流程结构</strong><small>执行顺序与并行关系</small></header>
        <div><span>序号</span><span>节点名称</span></div>
        <section>
          <span className="codicon codicon-list-tree" aria-hidden="true" />
          <strong>尚未选择实验操作</strong>
          <small>新建操作后，节点顺序将在这里同步显示。</small>
        </section>
      </aside>

      <section className="experiment-operation__empty-stage">
        <header>
          <span className="experiment-operation__empty-kind">实验操作</span>
          <div><strong>请选择实验操作</strong><small>创建后进入空白画布并添加设备动作</small></div>
        </header>
        <div className="experiment-operation__empty-canvas">
          <div>
            <span className="codicon codicon-type-hierarchy-sub" aria-hidden="true" />
            <strong>请选择或新建实验操作</strong>
            <small>设备动作可从左侧拖入画布进行编排。</small>
            <WorkflowButton
              type="button"
              disabled={!canCreate}
              disabledReason={createDisabledReason ?? '当前 Authority 不支持新建实验操作'}
              onClick={onCreate}
            >
              <span className="codicon codicon-add" aria-hidden="true" />
              新建实验操作
            </WorkflowButton>
          </div>
        </div>
      </section>

      <aside className="experiment-operation__empty-inspector">
        <header><h3>实验操作参数</h3></header>
        <div>
          <span className="codicon codicon-settings-gear" aria-hidden="true" />
          <strong>请选择实验操作</strong>
          <small>选择后配置业务参数、输入输出、物料及运行策略。</small>
        </div>
      </aside>
    </div>
  )
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
