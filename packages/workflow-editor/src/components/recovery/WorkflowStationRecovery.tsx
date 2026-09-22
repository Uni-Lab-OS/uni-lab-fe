import type { WorkflowRecoveryPort, WorkflowRuntimePort } from '@unilab/services'
import { RecoveryContext, useRecoveryController } from './RecoveryContext'
import { StationRecovery, stationRecoveryNeedsAttention } from './StationRecovery'
import './recovery.scss'

/** 工站异常属于整个工作区，即使没有打开工作流，也必须可以恢复。 */
export function WorkflowStationRecovery({
  runtime,
  active = true,
  workflowName,
  nodeNames
}: {
  runtime: WorkflowRuntimePort
  active?: boolean
  workflowName?: string
  nodeNames?: Record<string, string>
}) {
  if (!runtime.recovery) return null
  return <StationRecoveryHost
    key={runtime.recovery.scopeKey}
    port={runtime.recovery}
    active={active}
    workflowName={workflowName}
    nodeNames={nodeNames}
  />
}

function StationRecoveryHost({
  port,
  active,
  workflowName,
  nodeNames
}: {
  port: WorkflowRecoveryPort
  active: boolean
  workflowName?: string
  nodeNames?: Record<string, string>
}) {
  const { controller, state } = useRecoveryController(port, active)
  if (!active || !stationRecoveryNeedsAttention(state)) return null
  return <RecoveryContext.Provider value={{ port, revision: state.revision }}>
    <section className="workflow-recovery" aria-label="工作区异常处置">
      <StationRecovery
        controller={controller}
        state={state}
        writable={Boolean(state.station) && !state.readError && !state.pending && !state.unconfirmed}
        workflowName={workflowName}
        nodeNames={nodeNames}
      />
    </section>
  </RecoveryContext.Provider>
}
