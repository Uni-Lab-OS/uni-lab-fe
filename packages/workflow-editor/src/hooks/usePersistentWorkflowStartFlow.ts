import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringApplyResponse
} from '@unilab/services'
import { useRef, useState } from 'react'

import {
  createWorkflowStartFlow,
  type WorkflowStartCommand,
  type WorkflowStartContext,
  type WorkflowStartSourceReview
} from '../runtime/WorkflowStartFlow'
import { errorMessage } from '../utils/persistentAuthoringProjection'
import type { FullSourceDiff } from './persistentWorkflowAuthoringTypes'

type WorkflowStartDraftResult =
  | {
      kind: 'saved'
      aggregate: WorkflowAuthoringAggregate
      editMode: WorkflowStartContext['editMode']
    }
  | {
      kind: 'review'
      review: WorkflowStartSourceReview
    }

interface WorkflowStartCommands {
  saveDraft: () => Promise<WorkflowStartDraftResult>
  saveReviewedSource: (
    command: Extract<WorkflowStartCommand, { kind: 'save_reviewed_source' }>
  ) => Promise<{
    aggregate: WorkflowAuthoringAggregate
    editMode: WorkflowStartContext['editMode']
  }>
  applyCandidate: (
    candidateHash: string
  ) => Promise<WorkflowAuthoringApplyResponse>
  readApplied: () => Promise<WorkflowAuthoringAggregate>
  openTaskInput: (authority: WorkflowAuthoringAggregate) => Promise<void>
  resolveRemoteConflict: () => void
}

interface PersistentWorkflowStartFlowOptions {
  context: WorkflowStartContext
  hasRemoteInvalidation: () => boolean
  commands: WorkflowStartCommands
  setFullSourceDiff: (diff: FullSourceDiff | null) => void
  setMessage: (message: string) => void
  setError: (message: string | null) => void
}

/**
 * 把工作流（Workflow）单入口状态机连接到既有创作和任务输入接缝。
 *
 * @param options 当前创作上下文、远端失效检查、权威命令与界面写入器。
 * @returns 动态按钮投影、繁忙态和启动/确认/取消命令。
 */
export function usePersistentWorkflowStartFlow({
  context,
  hasRemoteInvalidation,
  commands,
  setFullSourceDiff,
  setMessage,
  setError
}: PersistentWorkflowStartFlowOptions) {
  // flowRef 只拥有浏览器内短生命周期顺序，不拥有工作流任务（WorkflowTask）。
  const flowRef = useRef(createWorkflowStartFlow())
  const flowPurposeRef = useRef<'run' | 'prepare'>('run')
  const [, setPresentationRevision] = useState(0)
  const [workflowStartBusy, setWorkflowStartBusy] = useState(false)

  /**
   * 强制重新投影状态机的动态按钮文案。
   *
   * @returns 无返回值；只推进本地展示修订。
   */
  const refreshPresentation = (): void => {
    setPresentationRevision((revision) => revision + 1)
  }

  /**
   * 串行执行状态机签发的单条命令，并把权威结果继续交回状态机。
   *
   * @param command 保存、差异确认、应用、精确补读或打开任务输入命令。
   * @returns 自动链路暂停或完成后的 Promise；异常会阻断后续运行。
   */
  const execute = async (
    command: WorkflowStartCommand,
    openTaskInput = true
  ): Promise<void> => {
    if (command.kind === 'blocked') throw new Error(command.message)
    if (command.kind === 'review_source') {
      setFullSourceDiff({ ...command.review, applyAfterSave: false })
      setMessage(
        command.review.reason === 'source_normalization'
          ? '草稿已保存；请确认 OS 规范化后的完整 Python，再继续运行'
          : '请确认画布生成的完整 Python，再继续运行'
      )
      return
    }
    if (command.kind === 'save_draft') {
      const result = await commands.saveDraft()
      const next = result.kind === 'saved'
        ? flowRef.current.resume({
            kind: 'draft_saved',
            aggregate: result.aggregate,
            editMode: result.editMode
          })
        : flowRef.current.resume({
            kind: 'source_review_required',
            review: result.review
          })
      await execute(next, openTaskInput)
      return
    }
    if (command.kind === 'save_reviewed_source') {
      const saved = await commands.saveReviewedSource(command)
      await execute(flowRef.current.resume({
        kind: 'draft_saved',
        aggregate: saved.aggregate,
        editMode: saved.editMode
      }), openTaskInput)
      return
    }
    if (command.kind === 'apply_candidate') {
      const response = await commands.applyCandidate(command.candidateHash)
      await execute(flowRef.current.resume({
        kind: 'candidate_applied',
        response
      }), openTaskInput)
      return
    }
    if (command.kind === 'read_applied') {
      const aggregate = await commands.readApplied()
      await execute(flowRef.current.resume({
        kind: 'applied_read',
        aggregate
      }), openTaskInput)
      return
    }
    if (openTaskInput) await commands.openTaskInput(command.authority)
    flowRef.current.cancel()
    refreshPresentation()
  }

  /**
   * 在统一繁忙态中执行一次工作流（Workflow）运行入口命令。
   *
   * @param command 状态机签发的第一条或恢复命令。
   * @returns 无返回值；错误关闭本次意图并保留权威已保存事实。
   */
  const run = (
    command: WorkflowStartCommand,
    purpose: 'run' | 'prepare' = flowPurposeRef.current
  ): void => {
    flowPurposeRef.current = purpose
    setWorkflowStartBusy(true)
    setError(null)
    refreshPresentation()
    void execute(command, purpose === 'run')
      .catch((startError) => {
        flowRef.current.cancel()
        setError(errorMessage(startError))
      })
      .finally(() => {
        setWorkflowStartBusy(false)
        if (flowRef.current.snapshot(context).phase === 'idle') {
          flowPurposeRef.current = 'run'
        }
        refreshPresentation()
      })
  }

  /**
   * 从当前创作状态启动单一运行入口。
   *
   * @returns 无返回值；存在远端失效时只进入冲突处理，不运行旧修订。
   */
  const startWorkflow = (): void => {
    flowPurposeRef.current = 'run'
    if (hasRemoteInvalidation()) {
      flowRef.current.cancel()
      commands.resolveRemoteConflict()
      refreshPresentation()
      return
    }
    const command = flowRef.current.start(context)
    if (command.kind === 'blocked') {
      setError(command.message)
      refreshPresentation()
      return
    }
    run(command, 'run')
  }

  /**
   * 保存并应用当前工作流定义，但停在创建任务之前。
   * 环境切换用它保证发布读取到最新定义；若规范化需要用户确认，则保留完整
   * 差异并拒绝本次切换，避免静默改写源码。
   */
  const prepareWorkflowDefinition = async (): Promise<void> => {
    if (workflowStartBusy) throw new Error('正在处理工作流，请稍候')
    if (hasRemoteInvalidation()) {
      commands.resolveRemoteConflict()
      throw new Error('检测到外部工作流修改，请处理冲突后重试')
    }
    flowPurposeRef.current = 'prepare'
    const command = flowRef.current.start(context)
    if (command.kind === 'blocked') throw new Error(command.message)
    setWorkflowStartBusy(true)
    setError(null)
    refreshPresentation()
    try {
      await execute(command, false)
      if (
        flowRef.current.snapshot(context).phase === 'awaiting_source_review'
      ) {
        throw new Error('请先确认工作流源码规范化差异，再切换环境')
      }
    } catch (prepareError) {
      if (
        flowRef.current.snapshot(context).phase !== 'awaiting_source_review'
      ) {
        flowRef.current.cancel()
      }
      setError(errorMessage(prepareError))
      throw prepareError
    } finally {
      setWorkflowStartBusy(false)
      if (flowRef.current.snapshot(context).phase === 'idle') {
        flowPurposeRef.current = 'run'
      }
      refreshPresentation()
    }
  }

  /**
   * 接受运行入口要求的完整源码差异并恢复自动链路。
   *
   * @returns 已处理时为 true；普通仅保存差异返回 false。
   */
  const acceptWorkflowStartReview = (): boolean => {
    if (flowRef.current.snapshot(context).phase !== 'awaiting_source_review') {
      return false
    }
    setFullSourceDiff(null)
    run(
      flowRef.current.resume({ kind: 'source_review_accepted' }),
      flowPurposeRef.current
    )
    return true
  }

  /**
   * 取消运行入口等待中的源码差异，不撤销已保存或已应用事实。
   *
   * @returns 已处理时为 true；普通仅保存差异返回 false。
   */
  const cancelWorkflowStartReview = (): boolean => {
    if (flowRef.current.snapshot(context).phase !== 'awaiting_source_review') {
      return false
    }
    const purpose = flowPurposeRef.current
    flowRef.current.cancel()
    flowPurposeRef.current = 'run'
    refreshPresentation()
    setMessage(
      purpose === 'prepare'
        ? '已取消环境切换准备；已保存的工作流源码保持不变'
        : '已取消本次运行；已保存的工作流源码保持不变'
    )
    return true
  }

  return {
    acceptWorkflowStartReview,
    cancelWorkflowStartReview,
    prepareWorkflowDefinition,
    startWorkflow,
    workflowStartBusy,
    workflowStartPresentation: flowRef.current.snapshot(context)
  }
}
