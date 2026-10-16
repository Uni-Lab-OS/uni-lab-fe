import { useCallback, useEffect, useRef, useState } from 'react'
import type { HumanInteractionReplyBody, WorkflowHumanInteraction } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'

export interface TaskHumanInteractionsState {
  readonly available: boolean
  readonly unavailableReason: string | null
  readonly items: readonly WorkflowHumanInteraction[]
  readonly loading: boolean
  readonly error: string | null
  readonly reload: () => Promise<void>
  readonly reply: (
    interaction: WorkflowHumanInteraction,
    body: HumanInteractionReplyBody,
  ) => Promise<void>
  readonly resolveImageUrl: (image: string) => string | null
}

/**
 * 读取当前 Task 的人工交互。只在 Task 切换、Task/Jobs 快照变化（来自全局 SSE
 * invalidation 后的重读）、回复之后以及操作员手动刷新时读取，不轮询。
 */
export function useTaskHumanInteractions(
  taskUuid: string | null,
  refreshKey: string,
): TaskHumanInteractionsState {
  const { backend } = useBackend()
  const capability = backend.getCapabilityStatus('workflow.humanInteraction')
  const port = backend.core.humanInteractions
  const [items, setItems] = useState<readonly WorkflowHumanInteraction[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sequence = useRef(0)

  const reload = useCallback(async () => {
    const current = ++sequence.current
    if (!taskUuid || !capability.available) {
      setItems([])
      setError(null)
      return
    }
    setLoading(true)
    try {
      const next = await port.listForTask(taskUuid)
      // 只接受最近一次请求的结果，避免切换 Task 后旧响应覆盖新 Task。
      if (current !== sequence.current) return
      setItems(next)
      setError(null)
    } catch (cause) {
      if (current !== sequence.current) return
      setError(cause instanceof Error ? cause.message : '读取人工交互失败')
    } finally {
      if (current === sequence.current) setLoading(false)
    }
  }, [capability.available, port, taskUuid])

  useEffect(() => {
    void reload()
  }, [reload, refreshKey])

  const reply = useCallback(
    async (interaction: WorkflowHumanInteraction, body: HumanInteractionReplyBody) => {
      try {
        await port.reply(interaction.interactionUuid, body)
      } finally {
        // 无论成功与否都重读 OS 权威状态：失败可能是已超时、已回复或任务已结束。
        await reload()
      }
    },
    [port, reload],
  )

  return {
    available: capability.available,
    unavailableReason: capability.available
      ? null
      : (capability.reason ?? '当前后端不支持人工交互'),
    items,
    loading,
    error,
    reload,
    reply,
    resolveImageUrl: (image: string) => port.resolveImageUrl(image),
  }
}
