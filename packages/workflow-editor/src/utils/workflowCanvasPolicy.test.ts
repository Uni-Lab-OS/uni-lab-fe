import { describe, expect, it } from 'vitest'

import {
  CANVAS_EDIT_WORKFLOW_CANVAS,
  READ_ONLY_WORKFLOW_CANVAS,
  workflowCandidateMaterializationDecision,
  visibleReadOnlyEdgeChanges,
  visibleReadOnlyNodeChanges
} from './workflowCanvasPolicy'
import * as workflowCanvasPolicy from './workflowCanvasPolicy'

type EditMode = 'code' | 'canvas'

interface D117PolicyModule {
  workflowAuthoringSurfacePolicy: (mode: EditMode) => {
    pythonEditorReadOnly: boolean
    canvasMutationEnabled: boolean
  }
  workflowAuthoringModeSwitchDecision: (input: {
    currentMode: EditMode
    requestedMode: EditMode
    activeSurfaceDirty: boolean
  }) => 'stay' | 'switch' | 'confirm_dirty'
  workflowCanvasDraftSaveDecision: (input: {
    baselinePython: string
    generatedPython: string
    fullDiffAccepted: boolean
  }) =>
    | {
        kind: 'review_full_diff'
        before: string
        after: string
      }
    | {
        kind: 'write_complete_draft'
        python_source: string
      }
  workflowAuthoringInvalidationDecision: (input: {
    dirty: boolean
    localPython: string
  }) =>
    | { kind: 'rehydrate' }
    | { kind: 'defer_remote'; editor_value: string }
}

const d117 = workflowCanvasPolicy as unknown as D117PolicyModule

describe('read-only workflow canvas policy', () => {
  it('disables every mutation entry point while preserving selection', () => {
    expect(READ_ONLY_WORKFLOW_CANVAS).toEqual({
      nodesDraggable: false,
      nodesConnectable: false,
      edgesUpdatable: false,
      deleteKeyCode: null,
      connectOnClick: false
    })
  })

  it('forwards only measurement and selection node changes', () => {
    expect(
      visibleReadOnlyNodeChanges([
        { id: 'node-1', type: 'position', position: { x: 10, y: 20 } },
        { id: 'node-1', type: 'remove' },
        {
          id: 'node-1',
          type: 'dimensions',
          dimensions: { width: 220, height: 92 }
        },
        { id: 'node-1', type: 'select', selected: true }
      ])
    ).toEqual([
      {
        id: 'node-1',
        type: 'dimensions',
        dimensions: { width: 220, height: 92 }
      },
      { id: 'node-1', type: 'select', selected: true }
    ])
  })

  it('forwards only edge selection changes', () => {
    expect(
      visibleReadOnlyEdgeChanges([
        {
          type: 'add',
          item: { id: 'edge-1', source: 'node-1', target: 'node-2' }
        },
        { id: 'edge-1', type: 'remove' },
        { id: 'edge-1', type: 'select', selected: true }
      ])
    ).toEqual([{ id: 'edge-1', type: 'select', selected: true }])
  })
})

describe('editable workflow canvas deletion policy', () => {
  /** 验证画布模式把两个标准删除键交给 ReactFlow 处理选中元素。 */
  it('enables Delete and Backspace for selected canvas elements', () => {
    expect(CANVAS_EDIT_WORKFLOW_CANVAS.deleteKeyCode).toEqual([
      'Delete',
      'Backspace'
    ])
  })
})

describe('D-117 single edit authority policy', () => {
  it('makes exactly one representation writable per Workflow session', () => {
    expect(d117.workflowAuthoringSurfacePolicy('code')).toEqual({
      pythonEditorReadOnly: false,
      canvasMutationEnabled: false
    })
    expect(d117.workflowAuthoringSurfacePolicy('canvas')).toEqual({
      pythonEditorReadOnly: true,
      canvasMutationEnabled: true
    })

    // Two Workflow sessions choose independently; there is no workspace lock.
    const workflowA = d117.workflowAuthoringSurfacePolicy('canvas')
    const workflowB = d117.workflowAuthoringSurfacePolicy('code')
    expect(workflowA.canvasMutationEnabled).toBe(true)
    expect(workflowB.pythonEditorReadOnly).toBe(false)
  })

  it('requires confirmation only when leaving a dirty writable surface', () => {
    expect(d117.workflowAuthoringModeSwitchDecision({
      currentMode: 'code',
      requestedMode: 'canvas',
      activeSurfaceDirty: true
    })).toBe('confirm_dirty')
    expect(d117.workflowAuthoringModeSwitchDecision({
      currentMode: 'canvas',
      requestedMode: 'code',
      activeSurfaceDirty: false
    })).toBe('switch')
    expect(d117.workflowAuthoringModeSwitchDecision({
      currentMode: 'code',
      requestedMode: 'code',
      activeSurfaceDirty: true
    })).toBe('stay')
  })

  it('cannot produce a complete Draft write before the full Python diff is accepted', () => {
    const input = {
      baselinePython: 'result = old()\n',
      generatedPython: 'result = new()\n'
    }

    expect(d117.workflowCanvasDraftSaveDecision({
      ...input,
      fullDiffAccepted: false
    })).toEqual({
      kind: 'review_full_diff',
      before: input.baselinePython,
      after: input.generatedPython
    })
    expect(d117.workflowCanvasDraftSaveDecision({
      ...input,
      fullDiffAccepted: true
    })).toEqual({
      kind: 'write_complete_draft',
      python_source: input.generatedPython
    })
  })

  it('preserves a dirty local buffer when SSE invalidates remote Authoring state', () => {
    expect(d117.workflowAuthoringInvalidationDecision({
      dirty: true,
      localPython: 'result = local_edit()\n'
    })).toEqual({
      kind: 'defer_remote',
      editor_value: 'result = local_edit()\n'
    })
    expect(d117.workflowAuthoringInvalidationDecision({
      dirty: false,
      localPython: 'result = clean()\n'
    })).toEqual({ kind: 'rehydrate' })
  })

  /**
   * 验证工作流创作候选（Candidate）只有在规范化源码已经成为持久工作流源码时
   * 才允许应用；参数是已保存源码与 OS 签发的规范化源码，返回公开 UI 决策。
   *
   * @returns 不返回值；候选物化门禁不满足预期时由 Vitest 报告失败。
   */
  function requiresNormalizedSourceReviewBeforeApply(): void {
    const draftPython = 'result=build()\n'
    const normalizedPython = 'result = build()\n'

    expect(workflowCandidateMaterializationDecision({
      draftPython,
      normalizedPython
    })).toEqual({
      kind: 'review_normalized_source',
      before: draftPython,
      after: normalizedPython
    })
    expect(workflowCandidateMaterializationDecision({
      draftPython: normalizedPython,
      normalizedPython
    })).toEqual({ kind: 'ready_to_apply' })
  }

  it(
    '规范化工作流源码未保存时必须先确认完整差异',
    requiresNormalizedSourceReviewBeforeApply
  )
})
