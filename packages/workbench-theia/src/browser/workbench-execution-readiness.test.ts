import { describe, expect, it } from 'vitest'

import {
  workflowExecutionStatusForConnection,
  workflowExecutionStatusForEdge
} from './workbench-execution-readiness'

describe('Workbench workflow execution readiness', () => {
  it('后端控制使用 Backend 运行能力而不是本地 Edge 状态', () => {
    expect(workflowExecutionStatusForConnection(
      'backend',
      {
        phase: 'idle',
        message: 'Edge Runtime 尚未启动',
        diagnostic: null
      },
      { available: true }
    )).toEqual({ available: true })
  })

  it('只在 Edge Runtime 就绪后开放工作流运行', () => {
    expect(workflowExecutionStatusForEdge({
      phase: 'ready',
      message: 'Edge Runtime 已就绪',
      diagnostic: null
    })).toEqual({ available: true })
  })

  it('在 OS 未启动时给出环境管理恢复动作', () => {
    expect(workflowExecutionStatusForEdge({
      phase: 'idle',
      message: 'Edge Runtime 尚未启动',
      diagnostic: null
    })).toEqual({
      available: false,
      reason: 'OS 尚未启动；请先在仿真调试或真实设备调试配置中启动 OS'
    })
  })

  it('保留失败诊断供用户定位', () => {
    expect(workflowExecutionStatusForEdge({
      phase: 'failed',
      message: 'Edge Runtime 未就绪',
      diagnostic: '设备运行时未连接'
    })).toEqual({
      available: false,
      reason: 'OS 未就绪：设备运行时未连接'
    })
  })
})
