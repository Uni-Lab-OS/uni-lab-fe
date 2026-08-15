import type {
  WorkflowRunNodeOption,
  WorkflowRunPreflightReport,
  WorkflowTaskRunMode
} from '@unilab/services'

import {
  EXISTING_WORKFLOW_RUN_MODE_OPTIONS,
  existingWorkflowPreflightSummaryLabel
} from '../utils/existingWorkflowRunProjection'

interface ExistingWorkflowRunSetupProps {
  runMode: WorkflowTaskRunMode
  targetNodeUuid: string
  enabledNodes: readonly WorkflowRunNodeOption[]
  disabled: boolean
  preparationLoading: boolean
  preparationError: string | null
  preflightLoading: boolean
  preflight: WorkflowRunPreflightReport | null
  preflightError: string | null
  preflightReady: boolean
  targetRequired: boolean
  onRunModeChange: (runMode: WorkflowTaskRunMode) => void
  onTargetNodeChange: (nodeUuid: string) => void
  onPreparationRetry: () => void
  onPreflightRetry: () => void
}

/**
 * 渲染 Backend 已有工作流的运行范围选择和只读预检结果。
 *
 * @param props 当前运行方式、可选节点、预检快照与恢复回调。
 * @returns 不持有服务器状态的可访问运行准备控件。
 */
export function ExistingWorkflowRunSetup({
  runMode,
  targetNodeUuid,
  enabledNodes,
  disabled,
  preparationLoading,
  preparationError,
  preflightLoading,
  preflight,
  preflightError,
  preflightReady,
  targetRequired,
  onRunModeChange,
  onTargetNodeChange,
  onPreparationRetry,
  onPreflightRetry
}: ExistingWorkflowRunSetupProps): React.JSX.Element {
  const targetUnavailable = runMode !== 'single_node' ||
    disabled || preparationLoading
  const noEnabledNode = !preparationLoading &&
    !preparationError && enabledNodes.length === 0
  const blockingChecks = preflight?.checks.filter((check) => (
    check.blocking || check.status === 'confirmation_required'
  )) ?? []
  const preflightSummary = existingWorkflowPreflightSummaryLabel({
    loading: preflightLoading,
    report: preflight,
    error: preflightError,
    targetRequired
  })
  return (
    <section
      className="workflow-runtime__existing-run-setup"
      aria-labelledby="existing-workflow-run-mode-title"
    >
      <div className="workflow-runtime__existing-run-mode">
        <strong id="existing-workflow-run-mode-title">运行方式</strong>
        <fieldset disabled={disabled}>
          <legend className="workflow-runtime__visually-hidden">选择工作流运行方式</legend>
          {EXISTING_WORKFLOW_RUN_MODE_OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name="existing-workflow-run-mode"
                value={option.value}
                checked={runMode === option.value}
                onChange={() => onRunModeChange(option.value)}
              />
              <span>
                <b>{option.label}</b>
                <small>{option.description}</small>
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="workflow-runtime__existing-run-target">
        <label htmlFor="existing-workflow-target-node">目标节点</label>
        <select
          id="existing-workflow-target-node"
          value={targetNodeUuid}
          disabled={targetUnavailable}
          onChange={(event) => onTargetNodeChange(event.currentTarget.value)}
        >
          <option value="">请选择一个可运行节点</option>
          {enabledNodes.map((node) => (
            <option key={node.workflow_node_uuid} value={node.workflow_node_uuid}>
              {node.name} · {node.type}
            </option>
          ))}
        </select>
        {preparationLoading ? <small>正在读取工作流节点…</small> : null}
        {preparationError ? (
          <small className="is-error">
            节点读取失败：{preparationError}
            <button type="button" onClick={onPreparationRetry}>重试</button>
          </small>
        ) : null}
        {noEnabledNode ? (
          <small className="is-error">当前工作流没有可运行节点</small>
        ) : null}
      </div>

      {blockingChecks.length > 0 ? (
        <details
          className="workflow-runtime__existing-run-preflight is-blocked"
          role="alert"
        >
          <summary>
            <span>运行预检</span>
            <strong>{preflightSummary}</strong>
            <span className="codicon codicon-chevron-down" aria-hidden="true" />
          </summary>
          <ul aria-label="运行预检阻塞原因">
            {blockingChecks.map((check, index) => (
              <li key={`${check.code}:${check.node_uuid ?? index}`}>
                <strong>{check.message}</strong>
                <span>
                  {check.node_name
                    ? `节点：${check.node_name}`
                    : check.node_uuid
                      ? `节点 ID：${check.node_uuid}`
                      : `检查类型：${check.type}`}
                  {' · '}状态：{check.status}
                  {' · '}错误码：{check.code}
                </span>
                {Object.keys(check.details).length > 0 ? (
                  <pre>{JSON.stringify(check.details, null, 2)}</pre>
                ) : null}
              </li>
            ))}
          </ul>
          <button type="button" onClick={onPreflightRetry}>重新预检</button>
        </details>
      ) : (
        <div
          className={`workflow-runtime__existing-run-preflight${preflightReady ? ' is-ready' : ''}`}
          role={preflightError ? 'alert' : 'status'}
          aria-live="polite"
        >
          <span>运行预检</span>
          <strong>{preflightSummary}</strong>
          {preflightError ? (
            <button type="button" onClick={onPreflightRetry}>重新预检</button>
          ) : null}
        </div>
      )}
    </section>
  )
}
