import { describe, expect, it } from 'vitest'

import {
  createWorkflowIdeSyncState,
  parseWorkflowPackageSource,
  packageSourceUriForResolvedUri,
  reduceWorkflowIdeSync,
  resolveWorkflowPackageSource,
  resolveWorkflowPackageSourceUri,
  synchronizeSavedWorkflowSource,
  WorkflowIdeHostAdapter,
  WORKFLOW_IDE_BRIDGE_COMPATIBILITY,
  workflowIdeMappingStatus,
  workflowNodeAtSourcePosition,
  workflowSourceLocationForNode,
  type WorkflowSourceProjection
} from './index'

const projection: WorkflowSourceProjection = {
  workflowUuid: 'workflow-1',
  sourceUri: 'package://szlab_poly_studio/workflows/s06_robot.py',
  sourceVersion: 'v1',
  mappingAvailable: true,
  sourceMap: [{
    workflow_node_uuid: 'node-1',
    start_line: 19,
    start_column: 5,
    end_line: 20,
    end_column: 57
  }]
}

describe('workflow IDE bridge', () => {
  it('publishes one explicit compatibility contract for both hosts', () => {
    expect(WORKFLOW_IDE_BRIDGE_COMPATIBILITY).toEqual({
      protocolVersion: 1,
      sourceMapContract: 'unilab.workflow-source-map/v1',
      packageSourceContract: 'unilab.package-source/v1',
      minimumOsContract: 'authoring-source-map/v1'
    })
  })

  it('drives reveal, reverse highlight and diagnostics through one host adapter', async () => {
    const reveals: unknown[] = []
    const diagnosticBatches: unknown[] = []
    const adapter = new WorkflowIdeHostAdapter({
      revealSource: async location => { reveals.push(location) },
      replaceDiagnostics: diagnostics => { diagnosticBatches.push(diagnostics) }
    })
    adapter.setPackageMounts([{
      packageId: 'szlab_poly_studio',
      packageRootUri: 'file:///workspace/szlab_poly_studio',
      editable: true,
      readOnly: false
    }, {
      packageId: 'catalog_lab',
      packageRootUri: 'file:///workspace/catalog_lab',
      editable: false,
      readOnly: true
    }])
    adapter.acceptSourceProjection(projection)
    adapter.acceptEditor({
      currentUri: 'file:///workspace/szlab_poly_studio/workflows/s06_robot.py',
      dirty: false,
      cursor: { line: 19, column: 8 }
    })

    expect(adapter.bridge.sourcePosition).toEqual({ line: 19, column: 8 })
    expect(adapter.bridge.activeSourceUri).toBe(projection.sourceUri)
    adapter.bridge.onRevealSourceLocation?.(
      workflowSourceLocationForNode(projection, 'node-1')!
    )
    adapter.bridge.onRevealPackageSource?.({
      sourceUri: 'package://catalog_lab/definitions.py',
      line: 7,
      column: 3,
      endLine: 7,
      endColumn: 18
    })
    await adapter.acceptDiagnostics([{
      sourceUri: projection.sourceUri,
      severity: 'error',
      code: 'invalid_transfer',
      message: '转运目标无效',
      line: 19,
      column: 5,
      endLine: 20,
      endColumn: 57
    }])
    await Promise.resolve()

    expect(reveals).toEqual([
      expect.objectContaining({
        resolvedUri: 'file:///workspace/szlab_poly_studio/workflows/s06_robot.py',
        line: 19,
        column: 5,
        readOnly: false
      }),
      expect.objectContaining({
        resolvedUri: 'file:///workspace/catalog_lab/definitions.py',
        line: 7,
        column: 3,
        readOnly: true
      })
    ])
    expect(diagnosticBatches.at(-1)).toEqual([
      expect.objectContaining({
        resolvedUri: 'file:///workspace/szlab_poly_studio/workflows/s06_robot.py',
        severity: 'error',
        code: 'invalid_transfer'
      })
    ])
  })

  it('publishes an IDE save with the workflow identity registered for that exact file', async () => {
    let hostSaveCount = 0
    const savedSources: unknown[] = []
    const adapter = new WorkflowIdeHostAdapter({
      revealSource: async () => {},
      replaceDiagnostics: () => {},
      saveActiveWorkflowSource: async () => { hostSaveCount += 1 }
    })
    adapter.setPackageMounts([{
      packageId: 'szlab_poly_studio',
      packageRootUri: 'file:///workspace/szlab_poly_studio',
      editable: true,
      readOnly: false
    }])
    adapter.acceptSourceProjection(projection)
    adapter.acceptEditor({
      currentUri: 'file:///workspace/szlab_poly_studio/workflows/s06_robot.py',
      dirty: true,
      cursor: { line: 19, column: 8 }
    })
    const subscription = adapter.bridge.subscribeSavedWorkflowSource?.(
      source => { savedSources.push(source) }
    )

    expect(adapter.bridge.activeWorkflowSourceDirty).toBe(true)
    await adapter.bridge.saveActiveWorkflowSource?.()
    expect(hostSaveCount).toBe(1)

    adapter.acceptEditor({
      currentUri: 'file:///workspace/szlab_poly_studio/workflows/s06_robot.py',
      dirty: false,
      cursor: { line: 19, column: 8 }
    })
    expect(adapter.acceptSavedWorkflowSource('value = 2\n')).toBe(true)
    expect(savedSources).toEqual([{
      workflowUuid: 'workflow-1',
      sourceUri: projection.sourceUri,
      sourceVersion: 'v1',
      pythonSource: 'value = 2\n'
    }])

    subscription?.dispose()
    expect(adapter.acceptSavedWorkflowSource('value = 3\n')).toBe(true)
    expect(savedSources).toHaveLength(1)
  })

  it('rejects a saved-source event from a tab other than the registered workflow file', () => {
    const adapter = new WorkflowIdeHostAdapter({
      revealSource: async () => {},
      replaceDiagnostics: () => {}
    })
    adapter.setPackageMounts([{
      packageId: 'szlab_poly_studio',
      packageRootUri: 'file:///workspace/szlab_poly_studio',
      editable: true,
      readOnly: false
    }])
    adapter.acceptSourceProjection(projection)
    adapter.acceptEditor({
      currentUri: 'file:///workspace/szlab_poly_studio/notes.py',
      dirty: false,
      cursor: null
    })

    expect(adapter.acceptSavedWorkflowSource('value = 2\n')).toBe(false)
    expect(adapter.bridge.activeWorkflowSourceDirty).toBe(false)
  })

  it('maps nodes and source positions using the same OS projection', () => {
    expect(workflowSourceLocationForNode(projection, 'node-1')).toMatchObject({
      sourceUri: projection.sourceUri,
      line: 19,
      column: 5
    })
    expect(workflowNodeAtSourcePosition(projection.sourceMap, {
      line: 19,
      column: 8
    })).toBe('node-1')
  })

  it('parses package identity without binding to a host filesystem API', () => {
    expect(parseWorkflowPackageSource(projection.sourceUri)).toEqual({
      packageId: 'szlab_poly_studio',
      relativePath: 'workflows/s06_robot.py'
    })
    expect(parseWorkflowPackageSource('package://pkg/../secret')).toBeNull()
    expect(resolveWorkflowPackageSourceUri(projection.sourceUri, [{
      packageId: 'szlab_poly_studio',
      packageRootUri: 'file:///workspace/szlab_poly_studio',
      editable: true,
      readOnly: false
    }])).toBe('file:///workspace/szlab_poly_studio/workflows/s06_robot.py')
    expect(resolveWorkflowPackageSourceUri(projection.sourceUri, [])).toBeNull()
  })

  it('re-resolves the same package identity after a Workspace move', () => {
    const before = [{
      packageId: 'szlab_poly_studio',
      packageRootUri: 'file:///old/SZLab/szlab_poly_studio',
      editable: true,
      readOnly: false
    }]
    const after = [{
      ...before[0]!,
      packageRootUri: 'file:///moved/SZLab/szlab_poly_studio'
    }]

    expect(resolveWorkflowPackageSourceUri(projection.sourceUri, before))
      .toBe('file:///old/SZLab/szlab_poly_studio/workflows/s06_robot.py')
    expect(resolveWorkflowPackageSourceUri(projection.sourceUri, after))
      .toBe('file:///moved/SZLab/szlab_poly_studio/workflows/s06_robot.py')
    expect(packageSourceUriForResolvedUri(
      'file:///moved/SZLab/szlab_poly_studio/workflows/s06_robot.py',
      after
    )).toBe(projection.sourceUri)
  })

  it('preserves the OS dependency read-only contract with exact navigation', () => {
    const dependency = {
      packageId: 'vendor_protocols',
      packageRootUri: 'file:///deps/vendor_protocols',
      editable: false,
      readOnly: true
    }
    expect(resolveWorkflowPackageSource(
      'package://vendor_protocols/workflows/shared.py',
      [dependency]
    )).toEqual({
      source: { packageId: 'vendor_protocols', relativePath: 'workflows/shared.py' },
      mount: dependency
    })
  })

  it('maps only the current exact tab and restores mapping after close and reopen', () => {
    const sourceUri = 'file:///workspace/workflows/s06_robot.py'
    let state = reduceWorkflowIdeSync(createWorkflowIdeSyncState(), {
      type: 'source-projection-changed',
      projection,
      resolvedSourceUri: sourceUri
    })
    state = reduceWorkflowIdeSync(state, {
      type: 'editor-changed',
      currentUri: 'file:///workspace/notes.py',
      dirty: false,
      cursor: { line: 19, column: 8 }
    })
    expect(state.sourcePosition).toBeNull()
    state = reduceWorkflowIdeSync(state, {
      type: 'editor-changed',
      currentUri: null,
      dirty: false,
      cursor: null
    })
    expect(state.sourcePosition).toBeNull()
    state = reduceWorkflowIdeSync(state, {
      type: 'editor-changed',
      currentUri: sourceUri,
      dirty: false,
      cursor: { line: 19, column: 8 }
    })
    expect(state.sourcePosition).toEqual({ line: 19, column: 8 })
  })

  it('pauses after edits until OS publishes a new source version', () => {
    const resolvedSourceUri = 'file:///workspace/workflows/s06_robot.py'
    let state = reduceWorkflowIdeSync(createWorkflowIdeSyncState(), {
      type: 'source-projection-changed',
      projection,
      resolvedSourceUri
    })
    state = reduceWorkflowIdeSync(state, {
      type: 'editor-changed',
      currentUri: resolvedSourceUri,
      dirty: true,
      cursor: { line: 19, column: 5 }
    })
    expect(workflowIdeMappingStatus(state)).toBe('paused: unsaved file')

    state = reduceWorkflowIdeSync(state, {
      type: 'editor-changed',
      currentUri: resolvedSourceUri,
      dirty: false,
      cursor: { line: 19, column: 5 }
    })
    expect(workflowIdeMappingStatus(state)).toBe(
      'paused: waiting for OS source map'
    )
    state = reduceWorkflowIdeSync(state, {
      type: 'source-projection-changed',
      projection: { ...projection, sourceVersion: 'v2' },
      resolvedSourceUri
    })
    expect(workflowIdeMappingStatus(state)).toBe('active')
    expect(state.sourcePosition).toEqual({ line: 19, column: 5 })
  })

  it('keeps navigation paused when the source file is known but its map is not', () => {
    const resolvedSourceUri = 'file:///workspace/workflows/s06_robot.py'
    const state = reduceWorkflowIdeSync(createWorkflowIdeSyncState(), {
      type: 'source-projection-changed',
      projection: {
        ...projection,
        sourceMap: [],
        mappingAvailable: false
      },
      resolvedSourceUri
    })

    expect(workflowIdeMappingStatus(state)).toBe(
      'paused: waiting for OS source map'
    )
    expect(state.sourcePosition).toBeNull()
  })

  it('recompiles an IDE-saved file with the hash OS just observed', async () => {
    const writes: unknown[] = []
    const result = await synchronizeSavedWorkflowSource({
      getWorkflowAuthoring: async () => ({
        workflow_revision: 7,
        draft: { python_source: 'value = 2\n', draft_hash: 'draft-v2' }
      }),
      saveWorkflowAuthoringDraft: async (workflowUuid, request) => {
        writes.push({ workflowUuid, request })
        return {
          workflow_revision: 7,
          draft: { python_source: 'value = 2\n', draft_hash: 'draft-v2' },
          candidate: {
            draft_hash: 'draft-v2',
            normalized_python_source: 'value = 2\n'
          }
        }
      }
    }, 'workflow-1', 'value = 2\n')

    expect(result).toEqual({
      kind: 'compiled',
      aggregate: expect.objectContaining({ workflow_revision: 7 })
    })
    expect(writes).toEqual([{
      workflowUuid: 'workflow-1',
      request: {
        python_source: 'value = 2\n',
        expected_draft_hash: 'draft-v2',
        expected_workflow_revision: 7
      }
    }])
  })

  it('returns OS-normalized source for editor review without a second write', async () => {
    const writes: unknown[] = []
    const compiled = {
      workflow_revision: 7,
      draft: { python_source: 'value=2\n', draft_hash: 'draft-raw' },
      candidate: {
        draft_hash: 'draft-raw',
        normalized_python_source: 'value = 2\n'
      }
    }
    const result = await synchronizeSavedWorkflowSource({
      getWorkflowAuthoring: async () => ({
        workflow_revision: 7,
        draft: { python_source: 'value=2\n', draft_hash: 'draft-raw' }
      }),
      saveWorkflowAuthoringDraft: async (workflowUuid, request) => {
        writes.push({ workflowUuid, request })
        return compiled
      }
    }, 'workflow-1', 'value=2\n')

    expect(result).toEqual({ kind: 'compiled', aggregate: compiled })
    expect(writes).toEqual([{
      workflowUuid: 'workflow-1',
      request: {
        python_source: 'value=2\n',
        expected_draft_hash: 'draft-raw',
        expected_workflow_revision: 7
      }
    }])
  })

  it('never overwrites a source changed again after the IDE save', async () => {
    let wrote = false
    const result = await synchronizeSavedWorkflowSource({
      getWorkflowAuthoring: async () => ({
        workflow_revision: 7,
        draft: { python_source: 'external = 3\n', draft_hash: 'draft-v3' }
      }),
      saveWorkflowAuthoringDraft: async () => {
        wrote = true
        throw new Error('must not write')
      }
    }, 'workflow-1', 'value = 2\n')

    expect(result).toEqual({ kind: 'source-changed' })
    expect(wrote).toBe(false)
  })
})
