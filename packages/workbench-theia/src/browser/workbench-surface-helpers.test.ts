import { describe, expect, it } from 'vitest'

import {
  emptyEdgeRuntimeSnapshot,
  emptyPlcSimulatorSnapshot,
  recordMountedWorkbenchDomains,
  workbenchViewLabel,
  type WorkbenchMountedDomain
} from './workbench-surface-helpers'

describe('Workbench 主区纯展示辅助', () => {
  /** 证明抽离后的领域挂载、标题和未启动快照保持原有稳定语义。 */
  it('保留已访问领域与初始运行事实', () => {
    const mountedDomains = new Set<WorkbenchMountedDomain>()

    recordMountedWorkbenchDomains(mountedDomains, 'split')
    recordMountedWorkbenchDomains(mountedDomains, 'workflow-tasks')
    recordMountedWorkbenchDomains(mountedDomains, 'robot-reagents')

    expect([...mountedDomains]).toEqual([
      'workflow',
      'material',
      'workflow-tasks',
      'robot-workstation'
    ])
    expect(workbenchViewLabel('split')).toBe('工作流 + 物料')
    expect(workbenchViewLabel('workflow-tasks')).toBe('工作流任务')
    expect(emptyEdgeRuntimeSnapshot()).toMatchObject({
      phase: 'idle',
      pid: null
    })
    expect(emptyPlcSimulatorSnapshot()).toMatchObject({
      phase: 'idle',
      pid: null
    })
  })
})
