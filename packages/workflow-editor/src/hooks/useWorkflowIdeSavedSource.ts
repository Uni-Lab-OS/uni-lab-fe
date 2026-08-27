import type {
  WorkflowAuthoringAggregate,
  WorkflowRuntimePort
} from '@unilab/services'
import {
  synchronizeSavedWorkflowSource,
  type WorkflowIdeBridge
} from '@unilab/workflow-ide-bridge'
import { useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'

import {
  AuthoringOperationQueue,
  draftSaveMessage,
  isAuthoringConflict
} from '../utils/persistentAuthoringSession'
import {
  workflowCandidateMaterializationDecision,
  type WorkflowEditMode
} from '../utils/workflowCanvasPolicy'
import type { FullSourceDiff } from './persistentWorkflowAuthoringTypes'

interface WorkflowIdeSavedSourceLocalState {
  mode: WorkflowEditMode
  canvasDirty: boolean
  aggregate: WorkflowAuthoringAggregate | null
}

interface WorkflowIdeSavedSourceOptions {
  enabled: boolean
  ideBridge?: WorkflowIdeBridge
  workflowUuid: string
  runtime: WorkflowRuntimePort
  localState: MutableRefObject<WorkflowIdeSavedSourceLocalState>
  queue: AuthoringOperationQueue
  run: (operation: () => Promise<void>) => Promise<void>
  installAggregate: (
    aggregate: WorkflowAuthoringAggregate,
    message: string
  ) => void
  onSynchronized: () => void
  readRemoteConflict: () => Promise<void>
  setError: Dispatch<SetStateAction<string | null>>
  setMessage: Dispatch<SetStateAction<string>>
  setFullSourceDiff: Dispatch<SetStateAction<FullSourceDiff | null>>
}

/** Owns IDE-save submission so the authoring surface remains host-neutral. */
export function useWorkflowIdeSavedSource({
  enabled,
  ideBridge,
  workflowUuid,
  runtime,
  localState,
  queue,
  run,
  installAggregate,
  onSynchronized,
  readRemoteConflict,
  setError,
  setMessage,
  setFullSourceDiff
}: WorkflowIdeSavedSourceOptions): void {
  useEffect(() => {
    const subscribe = ideBridge?.subscribeSavedWorkflowSource
    if (!subscribe || !enabled) return
    const subscription = subscribe((savedSource) => {
      const local = localState.current
      const current = local.aggregate
      if (
        savedSource.workflowUuid !== workflowUuid ||
        savedSource.sourceUri !== current?.draft?.source_uri
      ) return
      if (local.canvasDirty) {
        setError('画布还有未保存修改；源码已写入文件，但未提交工作流草稿')
        return
      }
      void run(async () => {
        try {
          const result = await queue.run(() => synchronizeSavedWorkflowSource(
            runtime,
            savedSource.workflowUuid,
            savedSource.pythonSource
          ))
          if (result.kind === 'source-unavailable') {
            throw new Error('当前工作流尚未注册可保存的 Python 源码')
          }
          if (result.kind === 'source-changed') {
            throw new Error('源码保存后又被修改；为避免覆盖，本次未提交工作流草稿')
          }
          const saved = result.aggregate
          onSynchronized()
          installAggregate(saved, draftSaveMessage(saved))
          const diff = workflowSourceNormalizationDiff(saved, local.mode)
          if (diff) {
            setFullSourceDiff(diff)
            setMessage('源码已保存；请检查并接受 OS 规范化产生的完整差异')
          }
        } catch (saveError) {
          if (!isAuthoringConflict(saveError)) throw saveError
          await readRemoteConflict()
        }
      })
    })
    return () => subscription.dispose()
  }, [
    enabled,
    ideBridge?.subscribeSavedWorkflowSource,
    installAggregate,
    localState,
    onSynchronized,
    queue,
    readRemoteConflict,
    run,
    runtime,
    setError,
    setFullSourceDiff,
    setMessage,
    workflowUuid
  ])
}

export function workflowSourceNormalizationDiff(
  aggregate: WorkflowAuthoringAggregate,
  resumeMode: WorkflowEditMode
): FullSourceDiff | null {
  const materialization = aggregate.candidate && aggregate.draft
    ? workflowCandidateMaterializationDecision({
        draftPython: aggregate.draft.python_source,
        normalizedPython: aggregate.candidate.normalized_python_source
      })
    : null
  if (materialization?.kind !== 'review_normalized_source') return null
  return {
    before: materialization.before,
    after: materialization.after,
    expectedDraftHash: aggregate.draft?.draft_hash ?? null,
    expectedWorkflowRevision: aggregate.workflow_revision,
    reason: 'source_normalization',
    resumeMode,
    applyAfterSave: false
  }
}
