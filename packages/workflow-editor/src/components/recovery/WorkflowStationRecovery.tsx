import type { WorkflowRecoveryPort, WorkflowRuntimePort } from '@unilab/services'
import { RecoveryContext, useRecoveryController } from './RecoveryContext'
import { StationRecovery } from './StationRecovery'
import './recovery.scss'

/** 工站异常属于整个工作区，即使没有打开工作流，也必须可以恢复。 */
export function WorkflowStationRecovery({ runtime, active = true }: { runtime: WorkflowRuntimePort; active?: boolean }) {
  return runtime.recovery ? <StationRecoveryHost key={runtime.recovery.scopeKey} port={runtime.recovery} active={active} /> : null
}
function StationRecoveryHost({ port, active }: { port: WorkflowRecoveryPort; active: boolean }) {
  const { controller, state } = useRecoveryController(port, active)
  const attention = Boolean(state.readError || state.unconfirmed || state.station?.mode === 'PAUSED' || state.station?.errors.length || state.station?.control_commands.some((item) => item.needs_apply))
  if (!active || !attention) return null
  return <RecoveryContext.Provider value={{ port, revision: state.revision }}>
    <section className="workflow-recovery" aria-label="工作区异常处置">
      <StationRecovery controller={controller} state={state} writable={Boolean(state.station) && !state.readError && !state.pending && !state.unconfirmed} />
    </section>
  </RecoveryContext.Provider>
}
