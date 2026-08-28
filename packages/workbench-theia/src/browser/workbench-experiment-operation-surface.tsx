import type { CapabilityStatus, Services } from '@unilab/services'
import {
  ExperimentOperationWorkbench,
  type ExperimentOperationWorkbenchProps
} from '@unilab/workflow-editor'
import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'

import { desktopWorkflowTraceRuntime } from './desktop-workflow-trace-runtime'
import { desktopWorkspaceApi } from './desktop-workspace'
import type { WorkbenchConnectionMode } from './workbench-connection-profile'
import { workflowExecutionStatusForConnection } from './workbench-execution-readiness'

export interface WorkbenchExperimentOperationContext {
  services: Services
  connectionMode: WorkbenchConnectionMode
  session: WorkbenchSessionSnapshot
  workflowRunStatus: CapabilityStatus
  resourceSlotOptionsPort:
    ExperimentOperationWorkbenchProps['resourceSlotOptionsPort']
  recoveryRevision: number
  active: boolean
  onUnsavedChangesChange: NonNullable<
    ExperimentOperationWorkbenchProps['onUnsavedChangesChange']
  >
  reportWorkflowUnsavedChanges: NonNullable<
    ExperimentOperationWorkbenchProps['onUnsavedChangesChange']
  >
  onSelectedWorkflowStepChange:
    ExperimentOperationWorkbenchProps['onSelectedWorkflowStepChange']
  onWorkflowRuntimeProjectionChange:
    ExperimentOperationWorkbenchProps['onWorkflowRuntimeProjectionChange']
}

/** 把实验操作目录接入当前 Workbench Authority，而不在视图内复制领域事实。 */
export function WorkbenchExperimentOperationSurface({
  context
}: {
  context: WorkbenchExperimentOperationContext
}): React.JSX.Element {
  const {
    services,
    connectionMode,
    session,
    workflowRunStatus,
    resourceSlotOptionsPort,
    recoveryRevision,
    active,
    onUnsavedChangesChange,
    reportWorkflowUnsavedChanges,
    onSelectedWorkflowStepChange,
    onWorkflowRuntimeProjectionChange
  } = context
  return (
    <section
      className="unilab-workbench__surface unilab-workbench__surface--operation"
      aria-label="实验操作调试窗口"
    >
      <ExperimentOperationWorkbench
        runtime={services.workflow}
        catalogStatus={services.getCapabilityStatus('workflow.readDefinitions')}
        traceRuntime={desktopWorkflowTraceRuntime(
          typeof window === 'undefined' ? undefined : window
        )}
        resourceSlotOptionsPort={resourceSlotOptionsPort}
        executionStatus={workflowExecutionStatusForConnection(
          connectionMode,
          session.edgeRuntime,
          workflowRunStatus
        )}
        active={active}
        recoveryRevision={recoveryRevision}
        hideEmbeddedCodeEditor={
          connectionMode === 'local' && desktopWorkspaceApi() !== null
        }
        onUnsavedChangesChange={(hasUnsavedChanges) => {
          onUnsavedChangesChange(hasUnsavedChanges)
          reportWorkflowUnsavedChanges(hasUnsavedChanges)
        }}
        onSelectedWorkflowStepChange={onSelectedWorkflowStepChange}
        onWorkflowRuntimeProjectionChange={onWorkflowRuntimeProjectionChange}
      />
    </section>
  )
}
