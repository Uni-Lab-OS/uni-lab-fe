/**
 * 测试用的全局 runtime invalidation 端口：只记录订阅者并允许测试手动投递事件，
 * 不模拟真实 SSE 传输、去重或重连语义。
 */
export function createRuntimeEventsStub() {
  const listeners = new Set<(event: unknown) => void>()
  let subscriptions = 0
  const port = {
    subscribe(listener: (event: unknown) => void) {
      subscriptions += 1
      listeners.add(listener)
      return {
        dispose: () => {
          listeners.delete(listener)
        },
      }
    },
  }
  return {
    port,
    get subscriptionCount() {
      return subscriptions
    },
    get listenerCount() {
      return listeners.size
    },
    emit(workflowTaskUuid = 'task-1') {
      for (const listener of [...listeners]) {
        listener({
          id: '1',
          event: 'workflow.runtime.changed',
          workflowTaskUuid,
          raw: {},
        })
      }
    },
  }
}
