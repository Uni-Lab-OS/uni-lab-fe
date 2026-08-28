import type { WorkflowActionCatalogSnapshot } from '@unilab/services'
import { describe, expect, it } from 'vitest'

import { workflowNodePaletteProjection } from './WorkflowNodePalette'
import {
  readWorkflowNodePaletteDragPayload,
  WORKFLOW_NODE_PALETTE_MIME,
  writeWorkflowNodePaletteDragPayload
} from '../utils/workflowCanvasCommands'

describe('workflowNodePaletteProjection', () => {
  it('keeps material, action, and child workflow categories visible', () => {
    const projection = workflowNodePaletteProjection(catalog, '', 'all')

    expect(projection.counts).toEqual({
      all: 3,
      material: 1,
      action: 1,
      workflow: 1
    })
    expect(projection.showMaterial).toBe(true)
    expect(projection.actions.map((template) => template.displayName))
      .toEqual(['固体投料'])
    expect(projection.workflows.map((template) => template.displayName))
      .toEqual(['样品制备'])
  })

  it('searches human-readable names and technical template origins', () => {
    expect(workflowNodePaletteProjection(catalog, '投料', 'all').totalCount)
      .toBe(1)
    expect(workflowNodePaletteProjection(catalog, 'sample_prep', 'all'))
      .toMatchObject({ totalCount: 1, showMaterial: false })
    expect(workflowNodePaletteProjection(catalog, 'site', 'all'))
      .toMatchObject({ totalCount: 1, showMaterial: true })
  })

  it('applies category selection before search results are rendered', () => {
    const projection = workflowNodePaletteProjection(catalog, '', 'workflow')

    expect(projection.showMaterial).toBe(false)
    expect(projection.actions).toEqual([])
    expect(projection.workflows).toHaveLength(1)
  })

  it('does not project a material placeholder without a real OS template', () => {
    const projection = workflowNodePaletteProjection(catalog, '', 'all', false)

    expect(projection.counts).toEqual({
      all: 2,
      material: 0,
      action: 1,
      workflow: 1
    })
    expect(projection.showMaterial).toBe(false)
  })

  it('serializes only node kind and stable template UUID for canvas drops', () => {
    const values = new Map<string, string>()
    const dataTransfer = {
      effectAllowed: 'none',
      setData: (type: string, value: string) => values.set(type, value),
      getData: (type: string) => values.get(type) ?? ''
    } as unknown as DataTransfer

    writeWorkflowNodePaletteDragPayload(dataTransfer, {
      kind: 'action',
      templateUuid: 'template-1'
    })

    expect(values.get(WORKFLOW_NODE_PALETTE_MIME)).toBe(
      '{"kind":"action","templateUuid":"template-1"}'
    )
    expect(readWorkflowNodePaletteDragPayload(dataTransfer)).toEqual({
      kind: 'action',
      templateUuid: 'template-1'
    })
  })
})

const catalog: WorkflowActionCatalogSnapshot = {
  actionTemplates: [{
    uuid: '10000000-0000-4000-8000-000000000001',
    resourceTemplateUuid: '20000000-0000-4000-8000-000000000001',
    name: 'powder_dosing',
    displayName: '固体投料',
    actionClass: 'SolidDosing',
    actionType: 'device',
    schema: {},
    goal: {},
    goalDefault: {},
    handles: []
  }],
  workflowTemplates: [{
    uuid: '30000000-0000-4000-8000-000000000001',
    resourceTemplateUuid: '40000000-0000-4000-8000-000000000001',
    name: 'sample_prep',
    displayName: '样品制备',
    workflowClass: 'SamplePrep',
    workflowUuid: '50000000-0000-4000-8000-000000000001',
    workflowRevision: 3,
    appliedSourceHash: 'source-hash',
    contractDigest: 'contract-digest',
    compositionAllowTransparent: false,
    inputOrder: [],
    outputOrder: [],
    schema: {},
    goal: {},
    goalDefault: {},
    result: {},
    source: {
      kind: 'package',
      definitionFqid: 'unilab.workflows.sample_prep',
      module: 'unilab.workflows',
      symbol: 'sample_prep',
      packageCatalogDigest: 'catalog-digest',
      definitionContentHash: 'definition-hash'
    },
    handles: []
  }]
}
