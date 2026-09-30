import { describe, expect, it } from 'vitest'
import { decodeSubmittedRun } from './codec'

describe('run preparation response codec', () => {
  it('turns develop task conflicts into an actionable error', () => {
    expect(() => decodeSubmittedRun({
      code: 3003,
      error: {
        code: 'develop_task_conflict',
        msg: 'develop_task_conflict:task-1:pending'
      }
    })).toThrowError(
      '开发模式已有未结束的任务（等待中，任务 ID：task-1），请先结束或取消该任务后再提交。'
    )
  })
})
