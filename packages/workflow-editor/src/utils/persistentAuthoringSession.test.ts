import { describe, expect, it, vi } from 'vitest'

import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringChangedEvent
} from '@unilab/services'

import {
  AuthoringOperationQueue,
  applyMaterializedWorkflowCandidate,
  authoringRemoteConflict,
  authoringSaveFailureAction,
  authoringProjection,
  authoringStateMessage,
  diagnosticRange,
  draftSaveMessage,
  hasRunnableAppliedWorkflow,
  isAuthoringConflict,
  isAuthoringSnapshotDirty,
  isSameAuthoringVersion,
  isCurrentAuthoringInvalidation,
  resolveWorkflowCanvasModeProjection
} from './persistentAuthoringSession'

/**
 * 证明工作流身份不一致会终止差异重试，而普通并发冲突仍补读远端状态。
 *
 * @returns 无返回值；断言两类失败进入互斥的前端处理动作。
 */
function classifiesIdentityMismatchAsNonRetryable(): void {
  expect(authoringSaveFailureAction({
    code: 'workflow_identity_mismatch'
  })).toBe('close_diff_and_report')
  expect(authoringSaveFailureAction({
    code: 'draft_hash_conflict'
  })).toBe('read_remote_conflict')
  expect(authoringSaveFailureAction({
    code: 'conflict'
  })).toBe('read_remote_conflict')
  expect(authoringSaveFailureAction({
    code: 'HTTP_REQUEST_FAILED'
  })).toBe('report')
}

const aggregate = (overrides: Partial<WorkflowAuthoringAggregate> = {}):
WorkflowAuthoringAggregate => ({
  workflow_uuid: '11111111-1111-4111-8111-111111111111',
  workflow_revision: 7,
  state: 'unapplied_graph',
  applied_graph: emptyGraph(),
  draft: {
    source_uri: 'package://lab/workflows/sample.py',
    python_source: 'result = old()\n',
    draft_hash: `sha256:${'a'.repeat(64)}`,
    update_time: '2026-08-01T00:00:00Z',
    diagnostics: []
  },
  candidate: {
    candidate_hash: `sha256:${'b'.repeat(64)}`,
    draft_hash: `sha256:${'a'.repeat(64)}`,
    base_workflow_revision: 7,
    graph: emptyGraph(),
    normalized_python_source: 'result = old()\n',
    source_map: [],
    diagnostics: [],
    changeset: { kind: 'graph' },
    compiler_version: 'test',
    template_catalog_fingerprint: `sha256:${'c'.repeat(64)}`
  },
  applied_source: null,
  topology_authoring: {
    authority: 'python_source',
    graph_mode: 'read_write',
    graph_to_python: 'supported'
  },
  ...overrides
})

describe('persistent Authoring session coordination', () => {
  it('工作流身份拒绝不会重复提交已接受差异', classifiesIdentityMismatchAsNonRetryable)

  it('冻结本地修改为远端冲突快照', () => {
    const local = {
      mode: 'canvas' as const,
      codeDirty: false,
      canvasDirty: true,
      editorValue: 'result = local()\n',
      graph: emptyGraph(),
      selectedNodeUuid: 'node-1',
      selectedNodeName: '本地节点',
      selectedNodeNameDirty: true
    }

    expect(isAuthoringSnapshotDirty(local)).toBe(true)
    expect(authoringRemoteConflict(aggregate(), local)).toMatchObject({
      localMode: 'canvas',
      localPython: 'result = local()\n',
      localGraph: local.graph,
      selectedNodeUuid: 'node-1',
      selectedNodeName: '本地节点',
      selectedNodeNameDirty: true
    })
  })

  it('applies the fresh Candidate issued after normalized source is saved', async () => {
    const calls: string[] = []
    const saved = aggregate({
      candidate: {
        ...aggregate().candidate!,
        candidate_hash: `sha256:${'d'.repeat(64)}`
      }
    })

    const result = await applyMaterializedWorkflowCandidate({
      save: async () => {
        calls.push('save')
        return saved
      },
      apply: async (candidateHash) => {
        calls.push(`apply:${candidateHash}`)
        return 'applied'
      }
    })

    expect(result).toEqual({ saved, applied: 'applied' })
    expect(calls).toEqual([
      'save',
      `apply:sha256:${'d'.repeat(64)}`
    ])
  })

  it('runs a direct I/O boundary but not an unconfigured or disabled graph', () => {
    expect(hasRunnableAppliedWorkflow(aggregate())).toBe(false)
    expect(hasRunnableAppliedWorkflow(aggregate({
      applied_graph: {
        ...emptyGraph(),
        workflow: {
          meta_data: {
            unilab: {
              input_contract: { version: 1, parameters: [] },
              output_contract: { version: 1, outputs: [] },
              output_bindings: {}
            }
          }
        }
      }
    }))).toBe(true)
    expect(hasRunnableAppliedWorkflow(aggregate({
      applied_graph: {
        ...emptyGraph(),
        nodes: [{ disabled: true, type: 'device' } as never]
      }
    }))).toBe(false)
    expect(hasRunnableAppliedWorkflow(aggregate({
      applied_graph: {
        ...emptyGraph(),
        nodes: [{ disabled: false, type: 'device' } as never]
      }
    }))).toBe(true)
  })

  it('runs a node-free Applied workflow whose outputs are resolved from inputs', () => {
    expect(hasRunnableAppliedWorkflow(aggregate({
      applied_graph: {
        ...emptyGraph(),
        workflow: {
          meta_data: {
            unilab: {
              input_contract: {
                version: 1,
                parameters: [{
                  name: 'sample',
                  schema: { $slot: 'ResourceSlot' },
                  required: true
                }]
              },
              output_contract: {
                version: 1,
                outputs: [{
                  name: 'sample',
                  schema: { $slot: 'ResourceSlot' },
                  implicit: false
                }]
              },
              output_bindings: {
                sample: { kind: 'workflow_input', parameter: 'sample' }
              }
            }
          }
        }
      }
    }))).toBe(true)
  })

  it('serializes initial GET, writes and SSE rehydration', async () => {
    const queue = new AuthoringOperationQueue()
    const calls: string[] = []
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = queue.run(async () => {
      calls.push('first:start')
      await firstGate
      calls.push('first:end')
      return 1
    })
    const second = queue.run(async () => {
      calls.push('second:start')
      return 2
    })

    await Promise.resolve()
    expect(calls).toEqual(['first:start'])
    releaseFirst?.()
    await expect(Promise.all([first, second])).resolves.toEqual([1, 2])
    expect(calls).toEqual(['first:start', 'first:end', 'second:start'])
  })

  it('continues after a failed operation without overlapping the next one', async () => {
    const queue = new AuthoringOperationQueue()
    await expect(queue.run(async () => {
      throw new Error('conflict')
    })).rejects.toThrow('conflict')
    await expect(queue.run(async () => 'rehydrated')).resolves.toBe('rehydrated')
  })

  /** 证明产品 Edge 通用冲突进入补读流程，而工作流身份拒绝保持独立。 */
  it('区分产品 Edge 通用冲突与工作流身份拒绝', () => {
    expect(isAuthoringConflict({
      status: 409,
      code: 'draft_hash_conflict'
    })).toBe(true)
    expect(isAuthoringConflict({ code: 'conflict' })).toBe(true)
    expect(isAuthoringConflict({
      status: 409,
      code: 'workflow_identity_mismatch'
    })).toBe(false)
  })

  it('uses the frozen state messages and distinguishes Candidate from Applied Graph', () => {
    expect(authoringStateMessage(aggregate({ state: 'draft_invalid' }))).toBe(
      '草稿存在错误，当前仍使用已保存的工作流'
    )
    expect(authoringStateMessage(aggregate({ state: 'compiling' }))).toBe(
      '正在检查工作流…'
    )
    expect(draftSaveMessage(aggregate({ state: 'draft_invalid', candidate: null })))
      .toBe('草稿已保存，但存在错误，修复后才能应用')
    expect(authoringProjection(aggregate()).kind).toBe('candidate')
    expect(authoringProjection(aggregate({ candidate: null })).kind).toBe('applied')
  })

  it('enters a managed exact canvas from the applied graph without graph-to-Python conversion', async () => {
    const appliedGraph = {
      ...emptyGraph(),
      nodes: [{ uuid: 'exact-node', type: 'action' }]
    }
    const generate = vi.fn()
    const authority = aggregate({
      applied_graph: appliedGraph,
      topology_authoring: {
        authority: 'managed_exact_graph',
        graph_mode: 'read_only',
        graph_to_python: 'unsupported'
      }
    })

    await expect(resolveWorkflowCanvasModeProjection({
      aggregate: authority,
      generate
    })).resolves.toEqual({
      graph: appliedGraph,
      pythonSource: 'result = old()\n',
      readOnly: true
    })
    expect(generate).not.toHaveBeenCalled()
  })

  it('preserves graph-to-Python conversion for a normal editable workflow', async () => {
    const generatedGraph = {
      ...emptyGraph(),
      nodes: [{ uuid: 'generated-node', type: 'action' }]
    }
    const authority = aggregate()
    const generate = vi.fn().mockResolvedValue({
      diagnostics: [],
      graph: generatedGraph,
      normalized_python_source: 'result = generated()\n',
      source_map: [],
      changeset: null,
      compiler_version: 'test',
      template_catalog_fingerprint: `sha256:${'c'.repeat(64)}`
    })

    await expect(resolveWorkflowCanvasModeProjection({
      aggregate: authority,
      generate
    })).resolves.toEqual({
      graph: generatedGraph,
      pythonSource: 'result = generated()\n',
      readOnly: false
    })
    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith(authority.candidate?.graph)
  })

  it('renders the nested diagnostic source range returned by OS', () => {
    expect(diagnosticRange({
      source_range: {
        start_line: 3,
        start_column: 5,
        end_line: 4,
        end_column: 8
      }
    })).toBe('3:5–4:8')
    expect(diagnosticRange({})).toBe('')
  })

  it('ignores an SSE tuple already represented by the installed aggregate', () => {
    const current = aggregate()
    const event: WorkflowAuthoringChangedEvent = {
      id: '41',
      event: 'workflow.authoring.changed',
      data: {
        workflow_uuid: current.workflow_uuid,
        cause: 'draft_saved',
        workflow_revision: current.workflow_revision,
        draft_hash: current.draft?.draft_hash ?? null,
        candidate_hash: current.candidate?.candidate_hash ?? null
      }
    }

    expect(isCurrentAuthoringInvalidation(event, current)).toBe(true)
    expect(isCurrentAuthoringInvalidation({
      ...event,
      data: { ...event.data, candidate_hash: null }
    }, current)).toBe(false)
  })

  it('discards a queued self-invalidation after its response aggregate is installed', () => {
    const installed = aggregate({ state: 'applied' })

    expect(isSameAuthoringVersion(aggregate({ state: 'applied' }), installed))
      .toBe(true)
    expect(isSameAuthoringVersion(aggregate({ state: 'draft_invalid' }), installed))
      .toBe(false)
    expect(isSameAuthoringVersion(aggregate({
      state: 'applied',
      candidate: null
    }), installed)).toBe(false)
  })
})

function emptyGraph(): WorkflowAuthoringAggregate['applied_graph'] {
  return {
    workflow: {},
    nodes: [],
    edges: [],
    node_templates: [],
    handle_templates: []
  }
}
