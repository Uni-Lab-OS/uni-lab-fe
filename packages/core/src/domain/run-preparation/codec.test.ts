import { describe, expect, it } from 'vitest'
import { decodeSubmittedRun } from './codec'

describe('run preparation response codec', () => {
  it('turns develop task conflicts into an actionable error', () => {
    expect(() =>
      decodeSubmittedRun({
        code: 3003,
        error: {
          code: 'develop_task_conflict',
          msg: 'develop_task_conflict:task-1:pending',
        },
      }),
    ).toThrowError(
      '开发模式已有未结束的任务（等待中，任务 ID：task-1），请先结束或取消该任务后再提交。',
    )
  })

  it('carries the material admission wait of an accepted task', () => {
    const submitted = decodeSubmittedRun({
      code: 0,
      data: {
        uuid: 'task-2',
        status: 'pending',
        wait_reason: {
          code: 'quantity_inventory_unavailable',
          message: '库存实例可用数量不足，无法完成整任务预留：现有 30 mL，其他任务已预留 20 mL，本任务需要 20 mL',
          resources: [{ scope: 'material', material_uuid: 'm-1', material_name: '展开溶剂瓶 1' }],
        },
      },
    })
    expect(submitted.materialWait).toEqual({
      code: 'quantity_inventory_unavailable',
      message: '库存实例可用数量不足，无法完成整任务预留：现有 30 mL，其他任务已预留 20 mL，本任务需要 20 mL',
      resources: ['展开溶剂瓶 1'],
    })
    expect(decodeSubmittedRun({ code: 0, data: { uuid: 'task-3', wait_reason: {} } }).materialWait).toBeUndefined()
  })
})
