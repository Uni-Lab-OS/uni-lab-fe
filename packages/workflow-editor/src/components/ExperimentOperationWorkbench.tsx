import type {
  CapabilityStatus,
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
import { WorkflowButton } from './WorkflowButton'
import './ExperimentOperation.module.scss'
import workflowStyles from './workflow.module.scss'

export interface ExperimentOperationWorkbenchProps {
  runtime: WorkflowRuntimePort
  catalogStatus: CapabilityStatus
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
  catalogStatus,
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
  const [requestRevision, setRequestRevision] = useState(0)

  const refreshDirectory = useCallback((): void => {
    setRequestRevision(value => value + 1)
  }, [])

  useEffect(() => {
    if (!active) return
    if (!catalogStatus.available) {
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
        setError(reason instanceof Error ? reason.message : String(reason))
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

  const selectedOperation = useMemo(
    () => operations.find(item => item.uuid === selectedOperationUuid) ?? null,
    [operations, selectedOperationUuid]
  )

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
      </header>

      {loading && !selectedOperation ? (
        <OperationDirectoryState title="正在读取实验操作目录" />
      ) : error ? (
        <OperationDirectoryState title="实验操作目录不可用" detail={error} error />
      ) : !selectedOperation ? (
        <OperationDirectoryState
          title="设备包尚未发布实验操作"
          detail="只有 Python 定义中由 OS 识别为 definition_kind=operation 的条目才会显示。"
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
            onUnsavedChangesChange={onUnsavedChangesChange}
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
    </section>
  )
}

function OperationDirectoryState({
  title,
  detail,
  error = false
}: {
  title: string
  detail?: string
  error?: boolean
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
    </div>
  )
}
