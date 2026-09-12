import type {
  WorkflowAuthoringAggregate,
  WorkflowRuntimePort
} from '@unilab/services'
import {
  synchronizeSavedWorkflowSource,
  type WorkflowIdeBridge,
  type WorkflowIdeSavedSource
} from '@unilab/workflow-ide-bridge'
import { useCallback, useEffect, type MutableRefObject } from 'react'

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

/** OS 同步完成后按最新界面状态安装，保留等待期间新增的画布修改。 */
export function installSynchronizedWorkflowSource(
  savedSource: WorkflowIdeSavedSource,
  saved: WorkflowAuthoringAggregate,
  options: Pick<WorkflowIdeSavedSourceOptions,
    'localState' | 'installAggregate' | 'installAggregateAgainstDirtyCanvas' | 'onSynchronized'>
): void {
  const latest = options.localState.current
  if (latest.aggregate?.workflow_uuid !== savedSource.workflowUuid
    || latest.aggregate.draft?.source_uri !== savedSource.sourceUri) {
    throw new Error('源码同步期间已切换工作流或源码文件，未覆盖当前画布')
  }
  if (workflowIdeSavedSourceInstallDecision(latest.canvasDirty).kind === 'preserve_dirty_canvas') {
    options.installAggregateAgainstDirtyCanvas(saved)
    return
  }
  options.onSynchronized()
  options.installAggregate(saved, draftSaveMessage(saved))
}

/** Save the active IDE source, then wait for that exact source to finish OS sync. */
export async function saveAndSynchronizeActiveWorkflowSource<TResult>(
  ideBridge: Pick<WorkflowIdeBridge, 'saveActiveWorkflowSource'> | undefined,
  synchronize: (savedSource: WorkflowIdeSavedSource) => Promise<TResult>
): Promise<TResult> {
  const saveActiveSource = ideBridge?.saveActiveWorkflowSource
  if (!saveActiveSource) {
    throw new Error('当前 IDE 宿主未提供工作流源码保存能力')
  }
  const savedSource = await saveActiveSource()
  return synchronize(savedSource)
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
}: WorkflowIdeSavedSourceOptions): {
  saveActiveSourceAndSynchronize: () => Promise<WorkflowAuthoringAggregate>
} {
  const synchronizeSource = useCallback(async (
    savedSource: WorkflowIdeSavedSource
  ): Promise<WorkflowAuthoringAggregate> => {
    const local = localState.current
    const current = local.aggregate
    if (
      savedSource.workflowUuid !== workflowUuid ||
      savedSource.sourceUri !== current?.draft?.source_uri
    ) {
      throw new Error('IDE 保存的源码与当前工作流注册文件不一致')
    }
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
    installSynchronizedWorkflowSource(savedSource, saved, {
      localState, installAggregate, installAggregateAgainstDirtyCanvas, onSynchronized
    })
    return saved
  }, [
    installAggregate,
    installAggregateAgainstDirtyCanvas,
    localState,
    onSynchronized,
    queue,
    runtime,
    workflowUuid
  ])

  useEffect(() => {
    const subscribe = ideBridge?.subscribeSavedWorkflowSource
    if (!subscribe || !enabled) return
    const subscription = subscribe((savedSource) => {
      const current = localState.current.aggregate
      if (
        savedSource.workflowUuid !== workflowUuid ||
        savedSource.sourceUri !== current?.draft?.source_uri
      ) return
      void run(async () => {
        try {
          await synchronizeSource(savedSource)
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
    readRemoteConflict,
    run,
    synchronizeSource
  ])

  const saveActiveSourceAndSynchronize = useCallback(async () => {
    try {
      return await saveAndSynchronizeActiveWorkflowSource(
        ideBridge,
        synchronizeSource
      )
    } catch (saveError) {
      if (!isAuthoringConflict(saveError)) throw saveError
      await readRemoteConflict()
      throw saveError
    }
  }, [ideBridge, readRemoteConflict, synchronizeSource])

  return { saveActiveSourceAndSynchronize }
}
