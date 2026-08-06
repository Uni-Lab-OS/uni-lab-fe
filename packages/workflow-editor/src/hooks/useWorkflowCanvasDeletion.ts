import type { WorkflowAuthoringGraph } from '@unilab/services'
import { useCallback } from 'react'

import {
  deleteWorkflowGraphElements,
  workflowGraphDeletionDecision,
  type WorkflowGraphDeletionSelection
} from '../utils/workflowGraphDeletion'

interface WorkflowCanvasDeletionOptions {
  graph: WorkflowAuthoringGraph | null
  enabled: boolean
  onGraphChange: (graph: WorkflowAuthoringGraph) => void
  onDirty: () => void
  onSelectionClear: () => void
  onError: (message: string | null) => void
  onMessage: (message: string) => void
}

/**
 * 把画布删除意图收敛为一次带影响确认的规范化候选事务。
 *
 * @param options 当前候选、编辑能力及工作流编辑状态回调。
 * @returns 可直接交给 DAG 画布的节点与连线删除请求处理器。
 */
export function useWorkflowCanvasDeletion({
  graph,
  enabled,
  onGraphChange,
  onDirty,
  onSelectionClear,
  onError,
  onMessage
}: WorkflowCanvasDeletionOptions): (
  selection: WorkflowGraphDeletionSelection
) => void {
  return useCallback((selection: WorkflowGraphDeletionSelection): void => {
    if (!graph || !enabled) {
      onError('当前模式只允许查看工作流画布')
      return
    }
    const decision = workflowGraphDeletionDecision(graph, selection)
    if (decision.kind === 'denied') {
      onError(decision.reason)
      return
    }
    const impactCount = decision.connectedEdgeCount +
      decision.removedOutputCount
    if (
      impactCount > 0 &&
      !globalThis.confirm(deletionConfirmationMessage(decision))
    ) return
    const result = deleteWorkflowGraphElements(graph, selection)
    onGraphChange(result.graph)
    onDirty()
    onSelectionClear()
    onError(null)
    onMessage(
      `已删除 ${result.removedNodeUuids.length} 个节点、` +
      `${result.removedEdgeUuids.length} 条连线；保存前将生成完整 Python`
    )
  }, [
    enabled,
    graph,
    onDirty,
    onError,
    onGraphChange,
    onMessage,
    onSelectionClear
  ])
}

/**
 * 生成人工确认所需的完整删除影响说明。
 *
 * @param decision 已通过只读边界检查的规范化删除决策。
 * @returns 包含关联连线与工作流出参数量的中文确认文案。
 */
function deletionConfirmationMessage(
  decision: Extract<
    ReturnType<typeof workflowGraphDeletionDecision>,
    { kind: 'allowed' }
  >
): string {
  return `删除将同时移除 ${decision.connectedEdgeCount} 条关联连线` +
    (decision.removedOutputCount > 0
      ? `和 ${decision.removedOutputCount} 个工作流出参`
      : '') +
    '。是否继续？'
}
