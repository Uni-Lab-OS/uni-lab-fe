import { describe, expect, it } from 'vitest'

import type { WorkflowAuthoringAggregate } from '@unilab/services'

import {
  projectWorkflowIdeDiagnostics,
  projectWorkflowSourceNavigation
} from './workflowSourceNavigation'

const HASH = `sha256:${'a'.repeat(64)}`

describe('workflow source navigation', () => {
  it('publishes a candidate map after a host-neutral structural clone', () => {
    const sourceMap = [{
      workflow_node_uuid: '22222222-2222-4222-8222-222222222222',
      start_line: 19,
      start_column: 5,
      end_line: 20,
      end_column: 57
    }]
    const aggregate = {
      workflow_uuid: '11111111-1111-4111-8111-111111111111',
      workflow_revision: 2,
      state: 'unapplied_graph',
      applied_graph: emptyGraph(),
      draft: {
        source_uri: 'package://lab/workflows/sample.py',
        python_source: 'result = changed()\n',
        draft_hash: HASH,
        update_time: '2026-08-09T12:57:49Z',
        diagnostics: []
      },
      candidate: {
        base_workflow_revision: 2,
        candidate_hash: `sha256:${'b'.repeat(64)}`,
        changeset: {
          kind: 'graph',
          created_node_uuids: [],
          updated_node_uuids: [],
          deleted_node_uuids: [],
          created_edge_uuids: [],
          updated_edge_uuids: [],
          deleted_edge_uuids: [],
          reserved_metadata_changed: false
        },
        compiler_version: 'test',
        draft_hash: HASH,
        graph: emptyGraph(),
        normalized_python_source: 'result = changed()\n',
        source_map: sourceMap,
        diagnostics: [],
        template_catalog_fingerprint: HASH,
      },
      applied_source: null,
      topology_authoring: {
        authority: 'python_source',
        graph_mode: 'read_write',
        graph_to_python: 'supported'
      }
    } satisfies WorkflowAuthoringAggregate

    expect(projectWorkflowSourceNavigation(
      aggregate,
      aggregate.workflow_uuid,
      structuredClone(sourceMap)
    )).toEqual({
      workflowUuid: aggregate.workflow_uuid,
      sourceUri: aggregate.draft.source_uri,
      sourceVersion: aggregate.candidate.candidate_hash,
      sourceMap,
      mappingAvailable: true
    })
  })

  it('keeps the source file bound while its saved draft awaits a source map', () => {
    const aggregate = {
      workflow_uuid: '11111111-1111-4111-8111-111111111111',
      workflow_revision: 2,
      state: 'applied_source_stale',
      applied_graph: emptyGraph(),
      draft: {
        source_uri: 'package://lab/workflows/sample.py',
        python_source: 'result = changed()\n',
        draft_hash: HASH,
        update_time: '2026-08-09T12:57:49Z',
        diagnostics: []
      },
      candidate: null,
      applied_source: null,
      topology_authoring: {
        authority: 'python_source',
        graph_mode: 'read_write',
        graph_to_python: 'supported'
      }
    } satisfies WorkflowAuthoringAggregate

    expect(projectWorkflowSourceNavigation(
      aggregate,
      aggregate.workflow_uuid,
      []
    )).toEqual({
      workflowUuid: aggregate.workflow_uuid,
      sourceUri: aggregate.draft.source_uri,
      sourceVersion: HASH,
      sourceMap: [],
      mappingAvailable: false
    })
  })

  it('publishes OS diagnostics against exact source ranges and node maps', () => {
    const nodeUuid = '22222222-2222-4222-8222-222222222222'
    const aggregate = {
      workflow_uuid: '11111111-1111-4111-8111-111111111111',
      workflow_revision: 2,
      state: 'unapplied_source_only',
      applied_graph: emptyGraph(),
      draft: {
        source_uri: 'package://lab/workflows/sample.py',
        python_source: 'result = changed()\n',
        draft_hash: HASH,
        update_time: '2026-08-09T12:57:49Z',
        diagnostics: [{
          severity: 'error',
          code: 'invalid_node',
          message: '节点参数无效',
          node_id: nodeUuid
        }, {
          severity: 'warning',
          code: 'deprecated_template',
          message: '模板即将停用',
          path: 'package://catalog/definitions.py',
          source_range: {
            start_line: 7,
            start_column: 3,
            end_line: 7,
            end_column: 18
          }
        }]
      },
      candidate: null,
      applied_source: null,
      topology_authoring: {
        authority: 'python_source',
        graph_mode: 'read_write',
        graph_to_python: 'supported'
      }
    } satisfies WorkflowAuthoringAggregate
    const projection = {
      workflowUuid: aggregate.workflow_uuid,
      sourceUri: aggregate.draft.source_uri,
      sourceVersion: HASH,
      mappingAvailable: true,
      sourceMap: [{
        workflow_node_uuid: nodeUuid,
        start_line: 19,
        start_column: 5,
        end_line: 20,
        end_column: 57
      }]
    }

    expect(projectWorkflowIdeDiagnostics(aggregate, projection)).toEqual([
      expect.objectContaining({
        sourceUri: aggregate.draft.source_uri,
        workflowNodeUuid: nodeUuid,
        line: 19,
        column: 5,
        endLine: 20,
        endColumn: 57
      }),
      expect.objectContaining({
        sourceUri: 'package://catalog/definitions.py',
        line: 7,
        column: 3,
        endLine: 7,
        endColumn: 18
      })
    ])
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
