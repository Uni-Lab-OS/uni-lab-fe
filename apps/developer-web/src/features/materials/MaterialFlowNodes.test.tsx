import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { NodeProps } from 'reactflow'
import type { MaterialGraphNode, SiteSummary } from '@unilab-fe/core'
import { ResourceBlockNode } from './MaterialFlowNodes'
import type { BlockNodeData } from './materialFlowModel'

function site(siteUuid: string, occupiedMaterialUuid: string | null): SiteSummary {
  return {
    kind: 'site',
    source: 'fixture',
    siteUuid,
    ownerMaterialUuid: 'stack',
    key: siteUuid,
    name: siteUuid,
    sortOrder: null,
    allowedResourceTemplateUuids: null,
    occupancy: { known: true, occupiedMaterialUuid },
    geometry: null,
    metadata: {},
    raw: {},
  }
}

function material(materialUuid: string, name: string) {
  return {
    kind: 'material_summary',
    source: 'fixture',
    materialUuid,
    resourceTemplateUuid: 'template-1',
    materialType: 'container',
    className: null,
    parentMaterialUuid: 'stack',
    barcode: null,
    name,
    description: null,
    revision: 1,
    config: {},
    metadata: {},
    createdAt: null,
    updatedAt: null,
    raw: {},
  } satisfies MaterialGraphNode['material']
}

function renderBlock(onSelect: (selection: unknown) => void) {
  const node = { material: material('stack', '烧杯堆栈1') } as MaterialGraphNode
  const data: BlockNodeData = {
    node,
    sites: [site('L1C1', null), site('L1C3', 'bottle')],
    occupantBySite: new Map([['L1C3', material('bottle', 'L1C3 注粉瓶')]]),
    selectionId: 'stack',
    label: '烧杯堆栈1',
    typeLabel: 'warehouse',
    hasSearch: false,
    highlighted: false,
    highlightedIds: new Set<string>(),
    onSelect: onSelect as BlockNodeData['onSelect'],
  }
  return render(
    <ResourceBlockNode {...({ id: 'stack', data } as unknown as NodeProps<BlockNodeData>)} />,
  )
}

describe('material flow slot click', () => {
  it('selects the site itself for an empty slot', () => {
    const onSelect = vi.fn()
    renderBlock(onSelect)

    fireEvent.click(screen.getByRole('button', { name: 'L1C1 · 空库位' }))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'site', siteId: 'L1C1' })
  })

  it('selects the site itself for an occupied slot instead of the occupant', () => {
    const onSelect = vi.fn()
    renderBlock(onSelect)

    // 落点不随占用状态而变：物料通过库位详情的「查看占用物料」钻取。
    fireEvent.click(screen.getByRole('button', { name: 'L1C3 · L1C3 注粉瓶' }))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'site', siteId: 'L1C3' })
  })
})
