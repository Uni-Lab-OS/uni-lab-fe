import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { MaterialGraph, MaterialGraphNode, SiteSummary } from '@unilab-fe/core'
import { projectMaterialInspection } from '@unilab-fe/core'
import { MaterialInspector } from './MaterialInspector'

function site(siteUuid: string, ownerMaterialUuid: string, occupiedMaterialUuid: string | null) {
  return {
    kind: 'site',
    source: 'fixture',
    siteUuid,
    ownerMaterialUuid,
    key: siteUuid,
    name: siteUuid,
    sortOrder: null,
    allowedResourceTemplateUuids: null,
    occupancy: { known: true, occupiedMaterialUuid },
    geometry: null,
    metadata: {},
    raw: {},
  } satisfies SiteSummary
}

function node(
  materialUuid: string,
  name: string,
  sites: readonly SiteSummary[],
  currentSiteUuid: string | null = null,
) {
  return {
    material: {
      kind: 'material_summary',
      source: 'fixture',
      materialUuid,
      resourceTemplateUuid: 'template-1',
      materialType: 'container',
      className: null,
      parentMaterialUuid: null,
      barcode: null,
      name,
      description: null,
      revision: 1,
      config: {},
      metadata: {},
      createdAt: null,
      updatedAt: null,
      raw: {},
    },
    resourceTemplate: null,
    relativePosition: null,
    sites,
    currentSiteUuid,
    raw: {},
  } satisfies MaterialGraphNode
}

const graph = {
  kind: 'material_graph',
  source: 'fixture',
  nodes: [
    node('warehouse', '固体粉桶堆栈', [
      site('L1C1', 'warehouse', null),
      site('L1C3', 'warehouse', 'bottle'),
    ]),
    node('bottle', 'L1C3 注粉瓶', [], 'L1C3'),
  ],
  raw: {},
} satisfies MaterialGraph

const projectionFor = (selection: Parameters<typeof projectMaterialInspection>[1]) => {
  const projection = projectMaterialInspection(graph, selection)
  if (!projection) throw new Error('fixture projection must resolve')
  return projection
}

describe('material inspector site presentation', () => {
  it('lists node sites without a direct 查看物料 shortcut', () => {
    const onSelect = vi.fn()
    render(
      <MaterialInspector
        projection={projectionFor({ kind: 'node', materialUuid: 'warehouse' })}
        selection={{ kind: 'node', nodeId: 'warehouse' }}
        onSelect={onSelect}
      />,
    )

    expect(screen.getByText('L1C1')).toBeInTheDocument()
    expect(screen.getByText('已占用物料')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /查看 .* 中的物料/ })).not.toBeInTheDocument()
    expect(screen.queryByText('查看物料')).not.toBeInTheDocument()

    // 查看占用物料改走「库位详情 → 查看占用物料」，节点列表本身仍可选中库位。
    fireEvent.click(screen.getByRole('button', { name: /L1C3/ }))
    expect(onSelect).toHaveBeenCalledWith({ kind: 'site', siteId: 'L1C3' })
  })

  it('omits the site section when inspecting an occupied material', () => {
    render(
      <MaterialInspector
        projection={projectionFor({ kind: 'material', materialUuid: 'bottle', siteUuid: 'L1C3' })}
        selection={{ kind: 'material', materialId: 'bottle', siteId: 'L1C3' }}
        onSelect={vi.fn()}
      />,
    )

    expect(screen.getByText('L1C3 注粉瓶')).toBeInTheDocument()
    expect(screen.getByText('当前库位')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '库位' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: '库位选择' })).not.toBeInTheDocument()
  })
})
