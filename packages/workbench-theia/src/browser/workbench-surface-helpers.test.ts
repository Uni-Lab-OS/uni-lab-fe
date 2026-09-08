import { describe, expect, it, vi } from 'vitest'

import {
  emptyEdgeRuntimeSnapshot,
  emptyPlcSimulatorSnapshot,
  recordMountedWorkbenchDomains,
  restartPlcSimulatorUnlessUnconfigured,
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

  it('restarts PLC-Sim when the project directory is configured', async () => {
    const session = {
      stopPlcSimulator: vi.fn().mockResolvedValue(undefined),
      startPlcSimulator: vi.fn().mockResolvedValue(undefined)
    }

    await expect(
      restartPlcSimulatorUnlessUnconfigured(session, '/workspace/PLC-Sim')
    ).resolves.toBe(true)
    expect(session.stopPlcSimulator).toHaveBeenCalledOnce()
    expect(session.startPlcSimulator).toHaveBeenCalledOnce()
  })

  it('skips PLC restart when the project directory is not configured', async () => {
    const session = {
      stopPlcSimulator: vi.fn(),
      startPlcSimulator: vi.fn()
    }

    await expect(restartPlcSimulatorUnlessUnconfigured(session, ''))
      .resolves.toBe(false)
    expect(session.stopPlcSimulator).not.toHaveBeenCalled()
    expect(session.startPlcSimulator).not.toHaveBeenCalled()
  })

  it('skips PLC restart when Host reports plc_configuration_missing', async () => {
    const session = {
      stopPlcSimulator: vi.fn().mockResolvedValue(undefined),
      startPlcSimulator: vi.fn().mockRejectedValue(
        new Error('[plc_configuration_missing] 未配置 PLC-Sim 项目目录')
      )
    }

    await expect(
      restartPlcSimulatorUnlessUnconfigured(session, '/workspace/PLC-Sim')
    ).resolves.toBe(false)
    expect(session.stopPlcSimulator).toHaveBeenCalledOnce()
    expect(session.startPlcSimulator).toHaveBeenCalledOnce()
  })

  it('rethrows a real PLC start failure', async () => {
    const session = {
      stopPlcSimulator: vi.fn().mockResolvedValue(undefined),
      startPlcSimulator: vi.fn().mockRejectedValue(
        new Error('[plc_project_invalid] PLC-Sim 项目无效')
      )
    }

    await expect(
      restartPlcSimulatorUnlessUnconfigured(session, '/workspace/PLC-Sim')
    ).rejects.toThrow('[plc_project_invalid]')
  })
})
