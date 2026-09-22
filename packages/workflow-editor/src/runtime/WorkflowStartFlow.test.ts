import type { WorkflowAuthoringAggregate } from '@unilab/services'
import { describe, expect, it } from 'vitest'

import { createWorkflowStartFlow } from './WorkflowStartFlow'

/**
 * 构造不含节点的规范工作流图（Workflow Graph）。
 *
 * @returns 具有完整顶层字段的空工作流图。
 */
function emptyGraph(): WorkflowAuthoringAggregate['applied_graph'] {
  return {
    workflow: {},
    nodes: [],
    edges: [],
    node_templates: [],
    handle_templates: []
  }
}

/**
 * 构造工作流创作（Workflow Authoring）测试权威聚合。
 *
 * @param overrides 需要覆盖的权威字段。
 * @returns 可供运行入口状态机使用的最小工作流创作聚合。
 */
function authoringAggregate(
  overrides: Partial<WorkflowAuthoringAggregate> = {}
): WorkflowAuthoringAggregate {
  return {
    workflow_uuid: '10000000-0000-4000-8000-000000000001',
    workflow_revision: 7,
    state: 'applied',
    applied_graph: emptyGraph(),
    draft: null,
    candidate: null,
    applied_source: null,
    ...overrides
  }
}

/**
 * 构造已保存且可应用的工作流创作候选（Workflow Authoring Candidate）。
 *
 * @returns 草稿源码与 OS 规范化源码一致的工作流创作聚合。
 */
function applicableCandidateAggregate(): WorkflowAuthoringAggregate {
  const pythonSource = 'def workflow():\n    return None\n'
  return authoringAggregate({
    state: 'unapplied_graph',
    draft: {
      source_uri: 'package://example/workflow.py',
      python_source: pythonSource,
      draft_hash: 'sha256:draft',
      update_time: '2026-08-05T00:00:00Z',
      diagnostics: []
    },
    candidate: {
      candidate_hash: 'sha256:candidate',
      draft_hash: 'sha256:draft',
      base_workflow_revision: 7,
      graph: emptyGraph(),
      normalized_python_source: pythonSource,
      source_map: [],
      diagnostics: [],
      changeset: {},
      compiler_version: 'test-compiler',
      template_catalog_fingerprint: 'sha256:catalog'
    }
  })
}

/**
 * 构造需要用户确认 OS 规范化工作流源码（Workflow Source）的候选。
 *
 * @returns 草稿源码与规范化源码不同的工作流创作聚合。
 */
function normalizedCandidateAggregate(): WorkflowAuthoringAggregate {
  const authority = applicableCandidateAggregate()
  return {
    ...authority,
    draft: authority.draft
      ? { ...authority.draft, python_source: 'def workflow(): return None' }
      : null
  }
}

/**
 * 证明未保存修改只会进入保存阶段，不会越过工作流源码（Workflow Source）保存门禁。
 *
 * @returns 无返回值；断言动态主入口文案及下一条公开命令。
 */
function provesDirtyWorkflowStartsWithSave(): void {
  const flow = createWorkflowStartFlow()
  const authority = authoringAggregate()
  const context = {
    aggregate: authority,
    dirty: true,
    blockedReason: null,
    editMode: 'code' as const
  }

  expect(flow.snapshot(context)).toMatchObject({
    label: '保存并运行',
    disabled: false,
    phase: 'idle'
  })
  expect(flow.start(context)).toEqual({ kind: 'save_draft' })
  expect(flow.snapshot(context)).toMatchObject({
    label: '保存并运行',
    disabled: true,
    phase: 'saving'
  })
}

/**
 * 证明已保存候选不会重复保存，而是直接提交候选哈希进入应用阶段。
 *
 * @returns 无返回值；断言动态文案、候选身份与应用阶段。
 */
function provesSavedCandidateStartsWithApply(): void {
  const flow = createWorkflowStartFlow()
  const context = {
    aggregate: applicableCandidateAggregate(),
    dirty: false,
    blockedReason: null,
    editMode: 'code' as const
  }

  expect(flow.snapshot(context)).toMatchObject({
    label: '应用并运行',
    disabled: false
  })
  expect(flow.start(context)).toEqual({
    kind: 'apply_candidate',
    candidateHash: 'sha256:candidate'
  })
  expect(flow.snapshot(context).phase).toBe('applying')
}

/**
 * 证明无待处理修改时仍会重新读取已应用工作流图（Applied Workflow Graph）的精确修订。
 *
 * @returns 无返回值；断言不会直接打开任务输入或创建工作流任务（WorkflowTask）。
 */
function provesCleanWorkflowReadsAppliedRevision(): void {
  const flow = createWorkflowStartFlow()
  const context = {
    aggregate: authoringAggregate(),
    dirty: false,
    blockedReason: null,
    editMode: 'canvas' as const
  }

  expect(flow.start(context)).toEqual({
    kind: 'read_applied',
    expectedRevision: 7
  })
  expect(flow.snapshot(context).phase).toBe('reading_applied')
}

/**
 * 证明一次保存并运行严格经过候选应用与精确修订补读后才开放任务输入。
 *
 * @returns 无返回值；断言工作流源码、候选和已应用修订的权威顺序。
 */
function provesSaveApplyReadSequenceBeforeInput(): void {
  const flow = createWorkflowStartFlow()
  const dirtyContext = {
    aggregate: authoringAggregate(),
    dirty: true,
    blockedReason: null,
    editMode: 'code' as const
  }
  expect(flow.start(dirtyContext)).toEqual({ kind: 'save_draft' })

  const savedAuthority = applicableCandidateAggregate()
  expect(flow.resume({
    kind: 'draft_saved',
    aggregate: savedAuthority,
    editMode: 'code'
  })).toEqual({
    kind: 'apply_candidate',
    candidateHash: 'sha256:candidate'
  })

  const appliedAuthority = authoringAggregate({ workflow_revision: 8 })
  expect(flow.resume({
    kind: 'candidate_applied',
    response: {
      apply_result: {
        kind: 'graph',
        previous_workflow_revision: 7,
        workflow_revision: 8,
        applied_candidate_hash: 'sha256:candidate',
        applied_source_hash: 'sha256:source',
        warnings: []
      },
      authoring: appliedAuthority
    }
  })).toEqual({ kind: 'read_applied', expectedRevision: 8 })
  expect(flow.resume({
    kind: 'applied_read',
    aggregate: appliedAuthority
  })).toEqual({ kind: 'open_task_input', authority: appliedAuthority })
}

/**
 * 证明规范化差异暂停自动链路，只有明确接受后才按同一 CAS 保存完整源码。
 *
 * @returns 无返回值；断言差异内容、双 CAS 和取消恢复能力。
 */
function provesNormalizedSourceNeedsExplicitReview(): void {
  const flow = createWorkflowStartFlow()
  const context = {
    aggregate: authoringAggregate(),
    dirty: true,
    blockedReason: null,
    editMode: 'code' as const
  }
  flow.start(context)

  const normalizedAuthority = normalizedCandidateAggregate()
  const reviewCommand = flow.resume({
    kind: 'draft_saved',
    aggregate: normalizedAuthority,
    editMode: 'code'
  })
  expect(reviewCommand).toMatchObject({
    kind: 'review_source',
    review: {
      before: 'def workflow(): return None',
      expectedDraftHash: 'sha256:draft',
      expectedWorkflowRevision: 7,
      reason: 'source_normalization',
      resumeMode: 'code'
    }
  })
  expect(flow.resume({ kind: 'source_review_accepted' })).toMatchObject({
    kind: 'save_reviewed_source',
    pythonSource: 'def workflow():\n    return None\n',
    expectedDraftHash: 'sha256:draft',
    expectedWorkflowRevision: 7
  })
  flow.cancel()
  expect(flow.snapshot(context).phase).toBe('idle')
}

/**
 * 证明编译无候选时关闭失败，不产生应用或任务输入命令。
 *
 * @returns 无返回值；断言状态机回到空闲并给出可行动诊断。
 */
function provesInvalidDraftStopsBeforeApply(): void {
  const flow = createWorkflowStartFlow()
  const context = {
    aggregate: authoringAggregate(),
    dirty: true,
    blockedReason: null,
    editMode: 'code' as const
  }
  flow.start(context)
  expect(flow.resume({
    kind: 'draft_saved',
    aggregate: authoringAggregate({ state: 'draft_invalid' }),
    editMode: 'code'
  })).toEqual({
    kind: 'blocked',
    message: '工作流源码未生成可应用候选，请修复诊断后重试'
  })
  expect(flow.snapshot(context).phase).toBe('idle')
  expect(flow.snapshot({
    ...context,
    dirty: false,
    aggregate: authoringAggregate({ state: 'draft_invalid' })
  })).toMatchObject({
    label: '保存并运行',
    disabled: true,
    disabledReason: '工作流草稿存在错误，请修改后再运行'
  })
}

/**
 * 证明应用后补读到其他修订时关闭失败，不能把旧版本或意外新版本用于运行。
 *
 * @returns 无返回值；断言不会产生打开任务输入命令。
 */
function provesRevisionRaceStopsBeforeInput(): void {
  const flow = createWorkflowStartFlow()
  const context = {
    aggregate: applicableCandidateAggregate(),
    dirty: false,
    blockedReason: null,
    editMode: 'code' as const
  }
  flow.start(context)
  const appliedAuthority = authoringAggregate({ workflow_revision: 8 })
  flow.resume({
    kind: 'candidate_applied',
    response: {
      apply_result: {
        kind: 'graph',
        previous_workflow_revision: 7,
        workflow_revision: 8,
        applied_candidate_hash: 'sha256:candidate',
        applied_source_hash: 'sha256:source',
        warnings: []
      },
      authoring: appliedAuthority
    }
  })
  expect(flow.resume({
    kind: 'applied_read',
    aggregate: authoringAggregate({ workflow_revision: 9 })
  })).toEqual({
    kind: 'blocked',
    message: '已应用工作流修订在运行前发生变化，请确认最新内容后重试'
  })
}

describe('WorkflowStartFlow', () => {
  it('未保存修改从保存工作流源码开始', provesDirtyWorkflowStartsWithSave)
  it('已保存候选直接进入应用阶段', provesSavedCandidateStartsWithApply)
  it('无修改时先确认已应用修订', provesCleanWorkflowReadsAppliedRevision)
  it('任务输入前严格保存应用并补读修订', provesSaveApplyReadSequenceBeforeInput)
  it('规范化差异必须明确确认后保存', provesNormalizedSourceNeedsExplicitReview)
  it('无有效候选时停止在应用之前', provesInvalidDraftStopsBeforeApply)
  it('应用后修订竞态停止在任务输入之前', provesRevisionRaceStopsBeforeInput)

  /** 环境未就绪只关闭运行入口，不改变工作流创作权威。 */
  it('OS 未就绪时阻止本地运行链路', () => {
    const flow = createWorkflowStartFlow()
    const context = {
      aggregate: authoringAggregate(),
      dirty: true,
      blockedReason: 'OS 尚未启动；请先在仿真调试或真实设备调试配置中启动 OS',
      editMode: 'canvas' as const
    }

    expect(flow.snapshot(context)).toMatchObject({
      disabled: true,
      disabledReason: context.blockedReason
    })
    expect(flow.start(context)).toEqual({
      kind: 'blocked',
      message: context.blockedReason
    })
  })
})
