import type {
  WorkflowAuthoringAggregate,
  WorkflowRuntimePort
} from '@unilab/services'
import {
  synchronizeSavedWorkflowSource,
  type WorkflowIdeBridge
} from '@unilab/workflow-ide-bridge'
import { useEffect, type MutableRefObject } from 'react'

import {
  AuthoringOperationQueue,
  draftSaveMessage,
  isAuthoringConflict
} from '../utils/persistentAuthoringSession'
interface WorkflowIdeSavedSourceLocalState {
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
  installAggregateAgainstDirtyCanvas: (
    aggregate: WorkflowAuthoringAggregate
  ) => void
  onSynchronized: () => void
  readRemoteConflict: () => Promise<void>
}

export type WorkflowIdeSavedSourceInstallDecision =
  | { kind: 'install' }
  | { kind: 'preserve_dirty_canvas' }

/** IDE 保存后只决定如何安装 OS 聚合，不把规范化源码升级为保存门禁。 */
export function workflowIdeSavedSourceInstallDecision(
  canvasDirty: boolean
): WorkflowIdeSavedSourceInstallDecision {
  return canvasDirty
    ? { kind: 'preserve_dirty_canvas' }
    : { kind: 'install' }
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
  installAggregateAgainstDirtyCanvas,
  onSynchronized,
  readRemoteConflict
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
          if (
            workflowIdeSavedSourceInstallDecision(local.canvasDirty).kind ===
            'preserve_dirty_canvas'
          ) {
            installAggregateAgainstDirtyCanvas(saved)
            return
          }
          onSynchronized()
          installAggregate(saved, draftSaveMessage(saved))
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
    installAggregateAgainstDirtyCanvas,
    localState,
    onSynchronized,
    queue,
    readRemoteConflict,
    run,
    runtime,
    workflowUuid
  ])
}
