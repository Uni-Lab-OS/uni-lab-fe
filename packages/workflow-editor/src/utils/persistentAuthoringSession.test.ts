import { describe, expect, it } from 'vitest'

import type {
  WorkflowAuthoringAggregate,
  WorkflowAuthoringChangedEvent
} from '@unilab/services'

import {
  AuthoringOperationQueue,
  applyMaterializedWorkflowCandidate,
  authoringProjection,
  authoringStateMessage,
  diagnosticRange,
  draftSaveMessage,
  hasRunnableAppliedWorkflow,
  isAuthoringConflict,
  isSameAuthoringVersion,
  isCurrentAuthoringInvalidation
} from './persistentAuthoringSession'

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
  ...overrides
})

describe('persistent Authoring session coordination', () => {
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

  it('does not run an empty or disabled Applied Graph', () => {
    expect(hasRunnableAppliedWorkflow(aggregate())).toBe(false)
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

  it('does not treat a cross-Workflow identity rejection as a CAS conflict', () => {
    expect(isAuthoringConflict({ code: 'draft_hash_conflict' })).toBe(true)
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
