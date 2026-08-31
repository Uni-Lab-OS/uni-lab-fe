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
import { PersistentWorkflowAuthoringPanel } from './PersistentWorkflowAuthoringPanel'
import { CreateExperimentOperationDialog } from './CreateExperimentOperationDialog'
import {
  ExperimentOperationDeviceCatalogProvider,
  type ExperimentOperationDeviceCatalogPort
} from './ExperimentOperationDeviceCatalog'
import { WorkflowButton } from './WorkflowButton'
import { WorkflowNodePalette } from './WorkflowNodePalette'
import './ExperimentOperation.module.scss'
import workflowStyles from './workflow.module.scss'

export interface ExperimentOperationWorkbenchProps {
  runtime: WorkflowRuntimePort
  deviceCatalogPort?: ExperimentOperationDeviceCatalogPort
  catalogStatus: CapabilityStatus
  creationStatus?: CapabilityStatus
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
  creationStatus = catalogStatus,
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
  const [directoryResolved, setDirectoryResolved] = useState(false)
  const [devices, setDevices] = useState<DeviceActionDeclarationDevice[]>([])
  const [devicesLoading, setDevicesLoading] = useState(false)
  const [devicesError, setDevicesError] = useState<string | null>(null)
  const [emptyActionCatalog, setEmptyActionCatalog] =
    useState<WorkflowActionCatalogSnapshot | null>(null)
  const [emptyActionCatalogError, setEmptyActionCatalogError] =
    useState<string | null>(null)
  const [requestRevision, setRequestRevision] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [authoringDirty, setAuthoringDirty] = useState(false)

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
      setDirectoryResolved(true)
      return
    }
    let disposed = false
    setLoading(true)
    setDirectoryResolved(false)
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
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false)
          setDirectoryResolved(true)
        }
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
  const createDisabledReason = !creationStatus.available
    ? creationStatus.reason ?? '当前 Authority 不支持创建实验操作'
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
      ...current.filter(item => item.uuid !== created.uuid)
    ])
    setSelectedOperationUuid(created.uuid)
    setAuthoringDirty(false)
    setError(null)
    setDirectoryResolved(true)
    setCreateOpen(false)
  }, [runtime])

  useEffect(() => {
    if (!active || !directoryResolved || selectedOperation) return
    if (!catalogStatus.available) {
      setEmptyActionCatalog(null)
      setEmptyActionCatalogError(
        catalogStatus.reason ?? '当前 Authority 不支持读取设备动作目录'
      )
      return
    }
    const controller = new AbortController()
    let disposed = false
    setEmptyActionCatalogError(null)
    void runtime.getWorkflowActionCatalog(controller.signal)
      .then(catalog => {
        if (!disposed) setEmptyActionCatalog(catalog)
      })
      .catch((reason: unknown) => {
        if (disposed || controller.signal.aborted) return
        setEmptyActionCatalog(null)
        setEmptyActionCatalogError(
          `操作目录加载失败：${errorMessage(reason)}`
        )
      })
    return () => {
      disposed = true
      controller.abort()
    }
  }, [
    active,
    catalogStatus.available,
    catalogStatus.reason,
    directoryResolved,
    requestRevision,
    runtime,
    selectedOperation
  ])

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
        <header className="experiment-operation__directory-bar">
        <div>
          <span>实验操作目录</span>
          <strong>{selectedOperation?.name ?? '等待选择实验操作'}</strong>
          <small>OS Definition · operation</small>
        </div>
        <label>
          <span className="sr-only">选择实验操作</span>
          <select
            aria-label="选择实验操作"
            value={selectedOperationUuid ?? ''}
            disabled={loading || operations.length === 0}
            onChange={event => setSelectedOperationUuid(
              event.target.value || null
            )}
          >
            {operations.length === 0 ? (
              <option value="">暂无实验操作</option>
            ) : operations.map(operation => (
              <option key={operation.uuid} value={operation.uuid}>
                {operation.name} · v{operation.revision}
              </option>
            ))}
          </select>
        </label>
        <WorkflowButton
          type="button"
          disabled={loading}
          disabledReason="实验操作目录正在刷新"
          onClick={refreshDirectory}
        >
          <span className="codicon codicon-refresh" aria-hidden="true" />
          刷新目录
        </WorkflowButton>
        <WorkflowButton
          type="button"
          className="is-primary"
          disabled={createDisabledReason !== null}
          disabledReason={createDisabledReason ?? '创建实验操作'}
          onClick={() => setCreateOpen(true)}
        >
          <span className="codicon codicon-add" aria-hidden="true" />
          新建实验操作
        </WorkflowButton>
        </header>

        {loading && !selectedOperation ? (
        <OperationDirectoryState title="正在读取实验操作目录" />
      ) : !selectedOperation ? (
        <ExperimentOperationEmptyCatalog
          catalog={emptyActionCatalog}
          catalogError={emptyActionCatalogError}
          directoryError={error}
          onRefresh={refreshDirectory}
          onCreate={createDisabledReason === null
            ? () => setCreateOpen(true)
            : undefined}
          createDisabledReason={createDisabledReason}
        />
      ) : (
        <div className="experiment-operation__persistent-workbench">
          <PersistentWorkflowAuthoringPanel
            key={selectedOperation.uuid}
            runtime={runtime}
            definitionAuthority="workspace"
            definitionEditingStatus={{ available: true }}
            definitionKind="operation"
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

export function ExperimentOperationEmptyCatalog({
  catalog,
  catalogError,
  directoryError,
  onRefresh,
  onCreate,
  createDisabledReason
}: {
  catalog: WorkflowActionCatalogSnapshot | null
  catalogError: string | null
  directoryError: string | null
  onRefresh(): void
  onCreate?: () => void
  createDisabledReason?: string | null
}): React.JSX.Element {
  return (
    <div className="experiment-operation__empty-catalog">
      <WorkflowNodePalette
        catalog={catalog}
        catalogError={catalogError}
        busy={false}
        canvasMutationEnabled={false}
        graphAvailable={false}
        materialSourceCatalogAvailable={false}
        materialSourceAuthorityBlocked={false}
        materialSourceCatalogLoading={false}
        materialSourceCatalogError={null}
        onAddMaterialSource={() => undefined}
        onAddAction={() => undefined}
        onAddWorkflow={() => undefined}
        onRefreshMaterialSourceCatalog={() => undefined}
      />
      <OperationDirectoryState
        title={directoryError
          ? '实验操作目录不可用'
          : '设备包尚未发布实验操作'}
        detail={directoryError ??
          '设备与 Action 已从当前 Authority 读取；创建并注册 Python operation 定义后即可编排和保存。'}
        error={Boolean(directoryError)}
        onRefresh={onRefresh}
        onCreate={onCreate}
        createDisabledReason={createDisabledReason}
      />
    </div>
  )
}

function OperationDirectoryState({
  title,
  detail,
  error = false,
  onRefresh,
  onCreate,
  createDisabledReason
}: {
  title: string
  detail?: string
  error?: boolean
  onRefresh?: () => void
  onCreate?: () => void
  createDisabledReason?: string | null
}): React.JSX.Element {
  return (
    <div
      className={`experiment-operation__directory-state${error ? ' is-error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      <span
        className={`codicon ${error ? 'codicon-warning' : 'codicon-loading'}`}
        aria-hidden="true"
      />
      <strong>{title}</strong>
      {detail ? <p>{detail}</p> : null}
      <div className="experiment-operation__directory-state-actions">
        {onCreate ? (
          <button type="button" className="is-primary" onClick={onCreate}>
            新建实验操作
          </button>
        ) : createDisabledReason ? (
          <button type="button" disabled title={createDisabledReason}>
            新建实验操作
          </button>
        ) : null}
        {onRefresh ? (
          <button type="button" onClick={onRefresh}>重新读取</button>
        ) : null}
      </div>
    </div>
  )
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
