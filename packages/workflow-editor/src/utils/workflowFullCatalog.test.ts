import { materialSourceCurrentLocation } from './materialSourceCurrentLocation'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createWorkflowRuntime, createMaterialService, resolveServerCapabilities, getDefaultBackend, type HttpClient } from '@unilab/services'
import { projectMaterialSourceEditor, updateMaterialSourceSelector, materialSourceGraphAuthorityProblem } from './workflowMaterialSource'

// Small complete wire contract: warehouse, base, child and planned loading site.
const captured = JSON.parse(readFileSync(new URL('../../../services/src/fixtures/material-source-contract-http.json', import.meta.url), 'utf8'))
const workflowUuid = '94131da4-7110-57ff-b36f-8b04a2ac1140'
function replay(responses = structuredClone(captured)) {
  const requested: string[] = []
  const http: HttpClient = { request: async <T,>(path: string, init?: RequestInit): Promise<T> => {
    if (init?.method && init.method !== 'GET') throw new Error('read-only replay')
    requested.push(path)
    if (!(path in responses)) throw new Error(`unrecorded route: ${path}`)
    return structuredClone(responses[path]) as T
  } }
  const backend = getDefaultBackend('local-python')
  const materialGraph = createMaterialService(http, backend, resolveServerCapabilities(backend))
  return { requested, materialGraph, runtime: createWorkflowRuntime(http, backend, { materialGraph }) }
}
describe('material source service contract', () => {
  it('passes all adapter layers and the startup guard without dropping sites metadata', async () => {
    const { runtime, requested, materialGraph } = replay()
    const catalog = await runtime.getWorkflowMaterialSourceCatalog()
    const aggregate = await runtime.getWorkflowAuthoring(workflowUuid)
    expect(catalog.materials).toHaveLength(3)
    expect(catalog.sites).toHaveLength(3)
    const nested = catalog.sites.find(site => site.occupiedMaterialUuid && catalog.sites.some(parent => parent.occupiedMaterialUuid === site.mountMaterialUuid))!
    expect(nested).toBeDefined()
    const location = materialSourceCurrentLocation(catalog, nested.occupiedMaterialUuid)
    expect(location.kind).toBe('located')
    if (location.kind === 'located') {
      expect(location.positions[0]?.ownerUuid).toBe(nested.mountMaterialUuid)
      expect(location.positions[0]?.siteUuid).toBe(nested.uuid)
      expect(location.positions.length).toBeGreaterThan(1)
    }
    const graph = structuredClone(aggregate.applied_graph)
    const source = graph.nodes.find(node => node.type === 'material_source')!
    const nestedMaterial = catalog.materials.find(material => material.uuid === nested.occupiedMaterialUuid)!
    if (location.kind !== 'located') throw new Error('expected nested fixture')
    source.param = { ...(source.param as Record<string, unknown>), mode: 'existing', material_uuid: nestedMaterial.uuid,
      resource_template_uuid: nestedMaterial.resourceTemplateUuid,
      mount: { uuid: location.positions[1]!.ownerUuid }, site: nested.uuid, slot_range: [] }
    const editor = projectMaterialSourceEditor(catalog, graph, String(source.uuid))
    expect(editor.staleReferences).toEqual([])
    expect(editor.currentLocation).toEqual(location)
    expect(() => updateMaterialSourceSelector(catalog, graph, String(source.uuid), editor)).not.toThrow()
    // Wrong current occupancy must remain editable; OS preflight is the
    // authority that rejects a fixed material missing from its declared site.
    const movedCatalog = structuredClone(catalog)
    movedCatalog.sites.find(site => site.uuid === nested.uuid)!.occupiedMaterialUuid = null
    expect(projectMaterialSourceEditor(movedCatalog, graph, String(source.uuid)).staleReferences).toEqual([])
    expect(() => updateMaterialSourceSelector(movedCatalog, graph, String(source.uuid), editor)).not.toThrow()
    source.param = { ...(source.param as Record<string, unknown>), mount: { uuid: nestedMaterial.uuid } }
    expect(projectMaterialSourceEditor(catalog, graph, String(source.uuid)).staleReferences).toContain(`库位 ${nested.uuid}`)
    source.param = { ...(source.param as Record<string, unknown>), mode: 'create_new', material_uuid: null, mount: { uuid: location.positions[1]!.ownerUuid } }
    expect(projectMaterialSourceEditor(catalog, graph, String(source.uuid)).staleReferences).toContain(`库位 ${nested.uuid}`)
    expect(aggregate.applied_graph.nodes).toHaveLength(1)
    expect(aggregate.applied_graph.nodes.filter(node => node.type === 'material_source')).toHaveLength(1)
    expect(materialSourceGraphAuthorityProblem(aggregate.applied_graph, catalog)).toBeNull()
    expect(requested).toHaveLength(Object.keys(captured).length)
    const materials = await materialGraph.getGraph({ kind: 'singleton' })
    const warehouse = materials.find(item => item.material.id === 'eda7467f-f501-58cf-a472-3210382038d4')!
    expect(warehouse.sites.find(site => site.name === 'cassette_09_layer_06')!.poseInAnchor.rotationDegXYZ).toEqual([0, 0, 288])
  })
  it('fails closed on malformed full-graph metadata and preserves the concrete error through the guard', async () => {
    const responses = structuredClone(captured)
    const site = responses['/api/v1/materials/graph'].data.nodes.find((node: { sites: unknown[] }) => node.sites.length).sites[0]
    site.meta_data.rotation_deg_xyz = { x: 0, y: 0 } // 不补造缺失轴。
    const { runtime } = replay(responses)
    let diagnostic = ''
    try { await runtime.getWorkflowMaterialSourceCatalog() } catch (error) { diagnostic = (error as Error).message }
    expect(diagnostic).toContain(site.uuid)
    expect(diagnostic).toContain('rotation_deg_xyz')
    const graph = (await runtime.getWorkflowAuthoring(workflowUuid)).applied_graph
    expect(materialSourceGraphAuthorityProblem(graph, null, diagnostic)).toBe(diagnostic)
    expect(materialSourceGraphAuthorityProblem(graph, null)).not.toBeNull()
  })
})
