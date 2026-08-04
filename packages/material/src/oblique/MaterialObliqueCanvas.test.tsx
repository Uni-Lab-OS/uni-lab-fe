import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import type { MaterialAggregate, MaterialSite } from '../types'
import { materialAggregate } from '../testFixtures'
import { MaterialObliqueCanvas } from './MaterialObliqueCanvas'
import { parseShapeLibrary } from './shapeSpec'

describe('MaterialObliqueCanvas', () => {
  it('renders accessible viewport controls, fidelity status and selected details', () => {
    const selected = materialAggregate('selected', {
      config: {
        rendering: {
          kind: 'vision_cell',
          dimensionsMm: [340, 510, 329]
        }
      }
    })
    const fallback = materialAggregate('fallback', {
      placement: {
        kind: 'world',
        pose: {
          positionMm: [520, 0, 0],
          rotationDegXYZ: [0, 0, 0]
        }
      },
      config: {
        rendering: {
          kind: 'unknown_device',
          dimensionsMm: [200, 180, 160]
        }
      }
    })
    const shapes = parseShapeLibrary([
      {
        id: 'vision_cell',
        bundle: 'test',
        categories: ['vision_cell'],
        categoryTokens: [],
        priority: 0,
        units: 'ratio',
        shadow: 'box',
        sort: 'center',
        parts: [
          {
            type: 'box',
            style: 'body',
            from: [0, 0, 0],
            to: [1, 1, 1]
          }
        ]
      }
    ])

    const markup = renderToStaticMarkup(
      <MaterialObliqueCanvas
        aggregates={[selected, fallback]}
        shapes={shapes}
        selectedMaterialIds={['selected']}
        onSelectionChange={() => undefined}
      />
    )

    expect(markup).toContain('aria-label="2.5D 视图控制"')
    expect(markup).toContain('aria-label="放大 2.5D 视图"')
    expect(markup).toContain('aria-label="聚焦已选物料"')
    expect(markup).toContain('data-semantic-zoom="overview"')
    expect(markup).not.toContain('声明外形 1')
    expect(markup).not.toContain('包络近似 1')
    expect(markup).not.toContain('推断结构')
    expect(markup).toContain('data-oblique-fidelity="declared"')
    expect(markup).toContain('data-oblique-fidelity="envelope"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).toContain('X 0 · Y 0 · Z 0 mm')
    expect(markup).toContain('滚轮缩放')
  })

  it('explains an empty scene while keeping the viewport controls visible', () => {
    const markup = renderToStaticMarkup(
      <MaterialObliqueCanvas aggregates={[]} />
    )

    expect(markup).toContain('当前物料图没有可展示对象')
    expect(markup).toContain('aria-label="适应全部物料"')
    expect(markup).not.toContain('role="status"')
  })

  it('renders a logical mount as site overlays without an independent body', () => {
    const warehouse = aggregate('s04-warehouse', {
      logicalMount: true,
      sites: [site('S041')]
    })

    const markup = renderToStaticMarkup(
      <MaterialObliqueCanvas aggregates={[warehouse]} />
    )

    expect(markup).toContain('data-material-id="s04-warehouse"')
    expect(markup).toContain('data-site-key="S041"')
    expect(markup).not.toContain('material-oblique-object__front')
    expect(markup).not.toContain('material-oblique-object__side')
    expect(markup).not.toContain('material-oblique-object__top')
  })

  it('paints a logical mount after its overlapping physical parent', () => {
    const logicalWarehouse = aggregate('a-logical-warehouse', {
      logicalMount: true,
      sites: [site('S041')]
    })
    const physicalParent = aggregate('z-physical-parent')

    const markup = renderToStaticMarkup(
      <MaterialObliqueCanvas
        aggregates={[logicalWarehouse, physicalParent]}
      />
    )

    expect(markup.indexOf('data-material-id="z-physical-parent"')).toBeLessThan(
      markup.indexOf('data-material-id="a-logical-warehouse"')
    )
  })

  it('does not render tip spots as generic site-bound overlays', () => {
    const tipBox = aggregate('tip-box', {
      sites: [site('TIP01', 'tip-spot'), site('CARRIER01')]
    })

    const markup = renderToStaticMarkup(
      <MaterialObliqueCanvas aggregates={[tipBox]} />
    )

    expect(markup).toContain('data-site-key="CARRIER01"')
    expect(markup).not.toContain('data-site-key="TIP01"')
  })
})

function aggregate(
  id: string,
  options: {
    logicalMount?: boolean
    sites?: readonly MaterialSite[]
  } = {}
): MaterialAggregate {
  return materialAggregate(id, {
    sites: options.sites,
    config: {
      logical_mount: options.logicalMount ?? false,
      rendering: {
        kind: 'process-warehouse',
        dimensionsMm: [710, 780, 359]
      }
    }
  })
}

function site(
  key: string,
  kind: NonNullable<MaterialSite['kind']> = 'site'
): MaterialSite {
  return {
    id: `site-${key}`,
    ownerMaterialId: 's04-warehouse',
    key,
    name: key,
    anchor: { kind: 'root' },
    poseInAnchor: {
      positionMm: [92.1, 89.4, 150],
      rotationDegXYZ: [0, 0, 0]
    },
    sizeMm: [86, 86, 120],
    capacity: 1,
    allowedTemplateIds: [],
    occupiedMaterialIds: [],
    kind,
    shape: 'rectangle',
    visible: true
  }
}
