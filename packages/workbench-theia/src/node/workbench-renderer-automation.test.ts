import { describe, expect, it } from 'vitest'

import {
  decodeMaterialRendererOptions,
  rendererRoute,
  WORKBENCH_RENDERER_AUTOMATION_PREFIX
} from './workbench-renderer-automation'

describe('Workbench renderer automation adapter', () => {
  it('only exposes bounded inspect, capture and cache reload routes', () => {
    expect(rendererRoute(
      'GET',
      `${WORKBENCH_RENDERER_AUTOMATION_PREFIX}/material/scene?view=3d`
    )).toBe('inspect')
    expect(rendererRoute(
      'POST',
      `${WORKBENCH_RENDERER_AUTOMATION_PREFIX}/material/capture`
    )).toBe('capture')
    expect(rendererRoute(
      'POST',
      `${WORKBENCH_RENDERER_AUTOMATION_PREFIX}/material/reload`
    )).toBe('reload')
    expect(rendererRoute('POST', '/api/v1/materials')).toBeNull()
  })

  it('normalizes query and JSON options without accepting arbitrary state', () => {
    expect(decodeMaterialRendererOptions({
      view: '2.5d',
      showSites: 'false',
      selected: 'material-a,material-b',
      viewport: '1440x960',
      timeout: '15000',
      layoutOverrides: [{
        sourceNodeId: 'device-a',
        positionMm: [1, 2, 3],
        rotationDegXYZ: [0, 0, 90]
      }]
    })).toEqual({
      view: '2.5d',
      showSites: false,
      selectedMaterialIds: ['material-a', 'material-b'],
      viewport: { width: 1440, height: 960 },
      layoutOverrides: [{
        sourceNodeId: 'device-a',
        positionMm: [1, 2, 3],
        rotationDegXYZ: [0, 0, 90]
      }],
      timeoutMs: 15000
    })
    expect(() => decodeMaterialRendererOptions({
      viewport: { width: 99999, height: 10 }
    })).toThrow('viewport.width')
    expect(() => decodeMaterialRendererOptions({
      layoutOverrides: [{ sourceNodeId: 'same' }, { sourceNodeId: 'same' }]
    })).toThrow('缺失或重复')
  })
})
