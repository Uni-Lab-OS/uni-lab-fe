import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkflowRecoveryPort } from '@unilab/services'
import type { PersistentWorkflowAuthoringModel } from '../persistentWorkflowAuthoringModel'
import { RecoveryContext, useRecoveryController } from './RecoveryContext'
import { ManualConfirmationPanel } from './ManualConfirmationPanel'
import './recovery.scss'

export function WorkflowRecoveryPanel({ model }: { model: PersistentWorkflowAuthoringModel }) {
  const port = model.runtime.recovery
  return <ConnectedRecovery key={port.scopeKey} port={port} model={model} />
}
function ConnectedRecovery({ port, model }: { port: WorkflowRecoveryPort; model: PersistentWorkflowAuthoringModel }) {
  const { controller, state } = useRecoveryController(port, model.active)
  const refreshTask = useRef(model.taskRuntime.refresh)
  refreshTask.current = model.taskRuntime.refresh
  const [taskReadError, setTaskReadError] = useState('')
  useEffect(() => {
    if (!model.active || !state.revision) return
    let disposed = false
    void refreshTask.current().then(() => { if (!disposed) setTaskReadError('') }, (error: unknown) => {
      if (!disposed) setTaskReadError(String(error))
    })
    return () => { disposed = true }
  }, [state.revision, model.active, model.task?.uuid])
  const refresh = useCallback(async () => {
    await Promise.all([controller.refresh(), refreshTask.current()])
  }, [controller])
  const writable = model.active && Boolean(state.station) && !state.readError && !state.pending && !state.unconfirmed && !taskReadError
  if (!model.active) return null
  return <RecoveryContext.Provider value={{ port, revision: state.revision }}>
    <section className="workflow-recovery" aria-label="人工确认">
      {taskReadError && <p role="alert">任务状态读取失败：{taskReadError}</p>}
      <ManualConfirmationPanel jobs={model.taskJobs} names={model.taskNodeNames} port={port}
        writable={writable && !model.taskRuntime.snapshot.error && !model.runtimeBusy} refresh={refresh} />
    </section>
  </RecoveryContext.Provider>
}
