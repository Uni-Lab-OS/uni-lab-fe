import { describe, expect, it } from 'vitest'
import type { WorkflowAuthoringAggregate, WorkflowAuthoringGraph, WorkflowMaterialSourceCatalogSnapshot } from '@unilab/services'
import fixture from '../../../services/src/fixtures/planned-material-source.json'
import { createWorkflowStartFlow } from '../runtime/WorkflowStartFlow'
import { materialSourceGraphAuthorityProblem, projectMaterialSourceEditor, updateMaterialSourceSelector } from './workflowMaterialSource'

const graph = () => structuredClone(fixture.graph) as unknown as WorkflowAuthoringGraph
const catalog = () => structuredClone(fixture.catalog) as unknown as WorkflowMaterialSourceCatalogSnapshot

describe('planned source through editor and start guard', () => {
  it('allows an empty plate inventory, projects named ranges and preserves planned semantics when saved', () => {
    let current = graph()
    const authority = catalog()
    expect(current.nodes).toHaveLength(1)
    expect(authority.materials).toHaveLength(1) // 只有真实 mount，尚无收集板。
    for (const node of current.nodes) {
      const editor = projectMaterialSourceEditor(authority, current, node.uuid as string)
      expect(editor.mode).toBe('planned_load')
      expect(editor.plannedLoadAvailable).toBe(true)
      expect(editor.staleReferences).toEqual([])
      expect(editor.fixedMaterials).toEqual([])
      expect(editor.candidateSiteUuids).toHaveLength(1)
      expect(authority.sites.some(site => site.uuid === editor.candidateSiteUuids[0])).toBe(true)
      current = updateMaterialSourceSelector(authority, current, editor.nodeUuid, editor)
    }
    expect(current.nodes.map(node => (node.param as { slot_range: string[] }).slot_range)).toEqual(graph().nodes.map(node => (node.param as { slot_range: string[] }).slot_range))
    expect(current.nodes.map(node => (node.param as { mode: string }).mode)).toEqual(Array(1).fill('planned_load'))
    expect(current.nodes.map(node => (node.param as { material_uuid: unknown }).material_uuid)).toEqual(Array(1).fill(null))
    expect(materialSourceGraphAuthorityProblem(current, authority)).toBeNull()
    const aggregate = { workflow_uuid: current.workflow.uuid, workflow_revision: fixture.workflow_revision,
      applied_graph: current, state: 'applied', candidate: null } as unknown as WorkflowAuthoringAggregate
    const context = { aggregate, dirty: false, blockedReason: materialSourceGraphAuthorityProblem(current, authority) ? '引用失效' : null }
    const start = createWorkflowStartFlow()
    expect(start.snapshot(context).disabled).toBe(false)
    expect(start.start(context).kind).toBe('read_applied')
  })
  it('still blocks missing templates, mount, sites, stale catalogue and ambiguous named sites', () => {
    const current = graph()
    const original = catalog()
    expect(materialSourceGraphAuthorityProblem(current, original, '目录不可用')).not.toBeNull()
    expect(materialSourceGraphAuthorityProblem(current, null)).not.toBeNull()
    for (const mutate of [
      (value: WorkflowMaterialSourceCatalogSnapshot) => { value.resourceTemplates = [] },
      (value: WorkflowMaterialSourceCatalogSnapshot) => { value.materials = [] },
      (value: WorkflowMaterialSourceCatalogSnapshot) => { value.sites = [] },
      (value: WorkflowMaterialSourceCatalogSnapshot) => { value.sites.push({ ...value.sites[0]!, uuid: 'ambiguous-other-site' }) },
      (value: WorkflowMaterialSourceCatalogSnapshot) => { value.sites.forEach(site => { site.mountMaterialUuid = 'another-mount' }) }
    ]) {
      const changed = catalog(); mutate(changed)
      expect(materialSourceGraphAuthorityProblem(current, changed)).not.toBeNull()
    }
  })
  it('never accepts a fixed existing plate as planned, and keeps existing-source missing-material checks', () => {
    const current = graph(), authority = catalog(), node = current.nodes[0]!
    const editor = projectMaterialSourceEditor(authority, current, node.uuid as string)
    node.param = { ...node.param as object, material_uuid: 'missing-plate' }
    expect(materialSourceGraphAuthorityProblem(current, authority)).not.toBeNull()
    node.param = { ...node.param as object, mode: 'existing', slot_range: editor.candidateSiteUuids }
    expect(projectMaterialSourceEditor(authority, current, node.uuid as string).staleReferences).toContain('物料 missing-plate')
    expect(materialSourceGraphAuthorityProblem(current, authority)).not.toBeNull()
    const clean = graph()
    expect(() => updateMaterialSourceSelector(authority, clean, editor.nodeUuid, { ...editor, siteScope: 'all' })).toThrow('目标库位范围')
  })
})
