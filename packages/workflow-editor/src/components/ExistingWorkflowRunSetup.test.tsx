import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { WorkflowRunPreflightReport } from '@unilab/services'

import { ExistingWorkflowRunSetup } from './ExistingWorkflowRunSetup'

describe('ExistingWorkflowRunSetup', () => {
  it('exposes Backend blocking reasons in an expandable preflight summary', () => {
    const preflight: WorkflowRunPreflightReport = {
      workflow_uuid: 'workflow-1',
      workflow_revision: 172,
      run_mode: 'normal',
      status: 'blocked',
      can_run: false,
      checked_at: '2026-08-14T11:10:46Z',
      summary: {
        execution_node_count: 0,
        passed_check_count: 0,
        blocking_check_count: 1,
        deferred_check_count: 0,
        confirmation_required_count: 0
      },
      checks: [{
        type: 'execution_plan',
        status: 'blocked',
        code: 'execution_plan_invalid',
        message: '组合节点映射跨越私有边界',
        blocking: true,
        node_uuid: 'node-1',
        node_name: '样品转运',
        details: { invocation_uuid: 'invocation-1' }
      }]
    }
    const markup = renderToStaticMarkup(
      <ExistingWorkflowRunSetup
        runMode="normal"
        targetNodeUuid=""
        enabledNodes={[]}
        disabled={false}
        preparationLoading={false}
        preparationError={null}
        preflightLoading={false}
        preflight={preflight}
        preflightError={null}
        preflightReady={false}
        targetRequired={false}
        onRunModeChange={vi.fn()}
        onTargetNodeChange={vi.fn()}
        onPreparationRetry={vi.fn()}
        onPreflightRetry={vi.fn()}
      />
    )

    expect(markup).toContain('<details')
    expect(markup).toContain('存在阻塞 · 1 项')
    expect(markup).toContain('运行预检阻塞原因')
    expect(markup).toContain('组合节点映射跨越私有边界')
    expect(markup).toContain('节点：样品转运')
    expect(markup).toContain('状态：blocked')
    expect(markup).toContain('错误码：execution_plan_invalid')
    expect(markup).toContain('invocation_uuid')
  })
})
