import { describe, expect, it } from 'vitest'

import type { WorkflowRunPreflightReport } from '@unilab/services'

import {
  EXISTING_WORKFLOW_RUN_MODE_OPTIONS,
  existingWorkflowPreflightFailureMessage,
  existingWorkflowPreflightReadinessKey,
  existingWorkflowPreflightSummaryLabel,
  existingWorkflowRunButtonLabel,
  existingWorkflowStartDisabledReason
} from './existingWorkflowRunProjection'

describe('Backend 已有工作流运行投影', () => {
  it('Edge 执行就绪后替换旧运行预检', () => {
    expect(existingWorkflowPreflightReadinessKey({
      available: false,
      reason: 'OS 正在连接 Backend'
    })).not.toBe(existingWorkflowPreflightReadinessKey({ available: true }))
  })

  /** 三种正式运行模式必须使用稳定 wire 值，并与单动作调试区分。 */
  it('公开完整运行、单步运行和单节点调试', () => {
    expect(EXISTING_WORKFLOW_RUN_MODE_OPTIONS.map((option) => option.value))
      .toEqual(['normal', 'step', 'single_node'])
    expect(existingWorkflowRunButtonLabel('normal')).toBe('运行已有工作流')
    expect(existingWorkflowRunButtonLabel('step')).toBe('创建单步运行任务')
    expect(existingWorkflowRunButtonLabel('single_node')).toBe('创建单节点运行任务')
  })

  /** 单节点目标缺失时必须先阻止提交，再向操作者说明恢复动作。 */
  it('单节点目标缺失时关闭失败', () => {
    expect(existingWorkflowPreflightSummaryLabel({
      loading: false,
      report: null,
      error: null,
      targetRequired: true
    })).toBe('选择目标节点后开始预检')
    expect(existingWorkflowStartDisabledReason({
      busy: false,
      loadingTask: false,
      liveTask: false,
      preflightLoading: false,
      preflight: null,
      preflightError: null,
      targetRequired: true
    })).toContain('必须先选择')
  })

  /** OS 未就绪时只禁止运行，并优先给出环境恢复动作。 */
  it('优先展示 OS 未就绪的运行门禁', () => {
    expect(existingWorkflowStartDisabledReason({
      busy: false,
      loadingTask: false,
      liveTask: false,
      executionBlockedReason: 'OS 尚未启动；请先在环境管理中启动 OS',
      preflightLoading: false,
      preflight: preflightReport('ready'),
      preflightError: null,
      targetRequired: false
    })).toBe('OS 尚未启动；请先在环境管理中启动 OS')
  })

  /** 通过的预检显示执行范围，并允许主操作进入创建阶段。 */
  it('投影已通过的 Backend 预检', () => {
    const report = preflightReport('ready')
    expect(existingWorkflowPreflightSummaryLabel({
      loading: false,
      report,
      error: null,
      targetRequired: false
    })).toBe('已通过 · 2 个执行节点')
  })

  /** 阻塞检查优先展示 Backend 给出的可定位诊断。 */
  it('展示 Backend 阻塞诊断而不猜测运行状态', () => {
    const report = preflightReport('blocked')
    expect(existingWorkflowPreflightFailureMessage(report))
      .toBe('运行预检未通过：设备当前离线')
    expect(existingWorkflowPreflightSummaryLabel({
      loading: false,
      report,
      error: null,
      targetRequired: false
    })).toBe('存在阻塞 · 1 项')
  })
})

/** 构造指定结论的最小 Backend 运行预检快照。 */
function preflightReport(
  status: WorkflowRunPreflightReport['status']
): WorkflowRunPreflightReport {
  const blocked = status === 'blocked'
  return {
    workflow_uuid: '50000000-0000-4000-8000-000000000001',
    workflow_revision: 1,
    run_mode: 'normal',
    status,
    can_run: !blocked,
    checked_at: '2026-08-12T00:00:00Z',
    summary: {
      execution_node_count: 2,
      passed_check_count: blocked ? 1 : 2,
      blocking_check_count: blocked ? 1 : 0,
      deferred_check_count: 0,
      confirmation_required_count: 0
    },
    checks: blocked ? [{
      type: 'device',
      status: 'blocked',
      code: 'device_offline',
      message: '设备当前离线',
      blocking: true,
      details: {}
    }] : []
  }
}
