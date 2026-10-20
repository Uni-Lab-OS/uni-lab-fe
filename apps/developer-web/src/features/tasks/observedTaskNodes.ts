import type { TaskRuntimeListItem } from '@unilab-fe/core'

export function nodeKey(taskId: string, nodeId: string): string {
  return `${taskId}|${nodeId}`
}

/**
 * 本会话在任务摘要中见过的节点（按后端实例隔离、有界）。摘要视图只列在途 Job，节点结束后
 * 列表里就没有它的名称；这里记住在途时 OS 给出的节点名（冻结定义事实），以及它是否以
 * 人工确认方式等待过，供调度甘特图给已结束的条命名、决定是否按需读取该作业详情。
 * 不记录任何运行状态。
 */
export interface ObservedTaskNodes {
  /** nodeKey → OS 节点名（未做展示映射）。 */
  readonly names: ReadonlyMap<string, string>
  /** 以人工确认方式等待过的节点（executor_kind=manual_confirm 或 intervention_required）。 */
  readonly manualConfirm: ReadonlySet<string>
}

interface Memory {
  readonly names: Map<string, string>
  readonly manualConfirm: Set<string>
}

const LIMIT = 5_000
const memories = new WeakMap<object, Memory>()

function memoryFor(backend: object): Memory {
  let memory = memories.get(backend)
  if (!memory) {
    memory = { names: new Map(), manualConfirm: new Set() }
    memories.set(backend, memory)
  }
  return memory
}

/** 记录摘要中的在途 Job；默认展示投影自带全部节点，无需记录。 */
export function observeTaskNodes(backend: object, tasks: readonly TaskRuntimeListItem[]): void {
  const memory = memoryFor(backend)
  for (const task of tasks) {
    if (task.kind !== 'task_runtime_summary') continue
    for (const job of task.activeJobs) {
      const key = nodeKey(task.taskUuid, job.workflowNodeUuid)
      if (job.nodeName) remember(memory.names, key, job.nodeName)
      if (job.executorKind === 'manual_confirm' || job.status === 'intervention_required') {
        memory.manualConfirm.delete(key)
        memory.manualConfirm.add(key)
        if (memory.manualConfirm.size > LIMIT) {
          memory.manualConfirm.delete(memory.manualConfirm.values().next().value!)
        }
      }
    }
  }
}

export function observedTaskNodes(backend: object): ObservedTaskNodes {
  return memoryFor(backend)
}

/** 最近见到的排在最后；超出上限时淘汰最早的。 */
function remember(names: Map<string, string>, key: string, name: string): void {
  names.delete(key)
  names.set(key, name)
  if (names.size > LIMIT) names.delete(names.keys().next().value!)
}
