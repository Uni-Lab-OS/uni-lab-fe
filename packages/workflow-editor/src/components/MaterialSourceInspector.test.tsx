import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { MaterialSourceEditorProjection } from '../utils/workflowMaterialSource'
import {
  filterMaterialSourceSites,
  MaterialSourceInspector
} from './PersistentWorkflowAuthoringPanel'

describe('MaterialSource Properties inspector', () => {
  it('renders the closed selector in LINQ-inspired groups and Site business order', () => {
    const markup = renderToStaticMarkup(
      <MaterialSourceInspector
        editor={editor()}
        editable
        status="material_waiting"
        diagnostics={[]}
        onChange={vi.fn()}
      />
    )

    expect(markup).toContain('物料来源属性')
    expect(markup).toContain('等待物料')
    expect(markup).toContain('物料角色')
    expect(markup).toContain('资源模板')
    expect(markup).toContain('已有物料')
    expect(markup).toContain('新建物料')
    expect(markup).toContain('挂载点')
    expect(markup).toContain('库位范围')
    expect(markup).toContain('搜索候选库位')
    expect(markup).toContain('已选择 1 / 2')
    expect(markup.indexOf('Slot 1')).toBeLessThan(markup.indexOf('Slot 2'))
    expect(markup).not.toContain('Closure State')
    expect(markup).not.toContain('Comments')
    expect(markup).not.toContain('Content')
  })

  it('filters candidate Sites by name, business order, and stable UUID', () => {
    const sites = editor().sites

    expect(filterMaterialSourceSites(sites, 'slot 2')).toEqual([sites[1]])
    expect(filterMaterialSourceSites(sites, '#1')).toEqual([sites[0]])
    expect(filterMaterialSourceSites(sites, '000002')).toEqual([sites[1]])
    expect(filterMaterialSourceSites(sites, 'missing')).toEqual([])
  })
})

function editor(): MaterialSourceEditorProjection {
  return {
    nodeUuid: '20000000-0000-4000-8000-000000000001',
    name: 'assay_plate',
    mode: 'existing',
    resourceTemplateUuid: '60000000-0000-4000-8000-000000000001',
    mountUuid: '50000000-0000-4000-8000-000000000001',
    fixedMaterialUuid: null,
    siteScope: 'candidates',
    fixedSiteUuid: null,
    candidateSiteUuids: ['70000000-0000-4000-8000-000000000001'],
    flowRole: 'primary_sample',
    resourceTemplates: [{
      uuid: '60000000-0000-4000-8000-000000000001',
      displayName: '384 Well Plate'
    }],
    mounts: [{
      uuid: '50000000-0000-4000-8000-000000000001',
      name: 'Stacker A',
      resourceTemplateUuid: '60000000-0000-4000-8000-000000000099',
      materialClass: 'Stacker'
    }],
    fixedMaterials: [],
    sites: [
      {
        uuid: '70000000-0000-4000-8000-000000000001',
        name: 'Slot 1',
        sortOrder: 1,
        mountMaterialUuid: '50000000-0000-4000-8000-000000000001',
        allowedResourceTemplateUuids: [
          '60000000-0000-4000-8000-000000000001'
        ],
        occupiedMaterialUuid: null
      },
      {
        uuid: '70000000-0000-4000-8000-000000000002',
        name: 'Slot 2',
        sortOrder: 2,
        mountMaterialUuid: '50000000-0000-4000-8000-000000000001',
        allowedResourceTemplateUuids: [],
        occupiedMaterialUuid: null
      }
    ],
    staleReferences: []
  }
}
