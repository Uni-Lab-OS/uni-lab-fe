import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { MaterialGraph, MaterialGraphNode, SiteSummary } from '@unilab-fe/core'
import { projectMaterialInspection } from '@unilab-fe/core'
import { MaterialInspector } from './MaterialInspector'

function site(
  siteUuid: string,
  ownerMaterialUuid: string,
  occupiedMaterialUuid: string | null,
  allowedResourceTemplateUuids: readonly string[] | null = null,
) {
  return {
    kind: 'site',
    source: 'fixture',
    siteUuid,
    ownerMaterialUuid,
    key: siteUuid,
    name: siteUuid,
    sortOrder: null,
    allowedResourceTemplateUuids,
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
  materialOverrides: Partial<MaterialGraphNode['material']> = {},
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
      ...materialOverrides,
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
      // L1C2 限定了模板，但图里没有任何节点使用该模板。
      site('L1C2', 'warehouse', null, ['template-unused']),
      site('L1C3', 'warehouse', 'bottle'),
    ]),
    node('bottle', 'L1C3 注粉瓶', [], 'L1C3'),
    node('free', '待分配物料', []),
    // 画布本来就不展示的节点：不能出现在上料候选里。
    node('virtual', '虚拟传送位', [], null, { config: { virtual: true } }),
    node('logical', '逻辑挂载位', [], null, { config: { logical_mount: true } }),
    node('host', 'host_node', [], null, { className: 'host_node' }),
    node('deck', '聚合物工作站台面', [], null, { materialType: 'deck' }),
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
        graph={graph}
        projection={projectionFor({ kind: 'node', materialUuid: 'warehouse' })}
        selection={{ kind: 'node', nodeId: 'warehouse' }}
        onSelect={onSelect}
        onChangeSite={vi.fn(async () => undefined)}
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
        graph={graph}
        projection={projectionFor({ kind: 'material', materialUuid: 'bottle', siteUuid: 'L1C3' })}
        selection={{ kind: 'material', materialId: 'bottle', siteId: 'L1C3' }}
        onSelect={vi.fn()}
        onChangeSite={vi.fn(async () => undefined)}
      />,
    )

    expect(screen.getByText('L1C3 注粉瓶')).toBeInTheDocument()
    expect(screen.getByText('当前库位')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '库位' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: '库位选择' })).not.toBeInTheDocument()
  })

  it('confirms unloading the material occupying the selected site', async () => {
    const onChangeSite = vi.fn(async () => undefined)
    render(
      <MaterialInspector
        graph={graph}
        projection={projectionFor({ kind: 'site', siteUuid: 'L1C3' })}
        selection={{ kind: 'site', siteId: 'L1C3' }}
        onSelect={vi.fn()}
        onChangeSite={onChangeSite}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '下料' }))
    expect(screen.getByRole('dialog', { name: '从 L1C3 下料' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '确认下料' }))

    await waitFor(() => {
      expect(onChangeSite).toHaveBeenCalledWith('bottle', 1, undefined)
    })
  })

  it('keeps 查看占用物料 and the site handling action in one row', () => {
    render(
      <MaterialInspector
        graph={graph}
        projection={projectionFor({ kind: 'site', siteUuid: 'L1C3' })}
        selection={{ kind: 'site', siteId: 'L1C3' }}
        onSelect={vi.fn()}
        onChangeSite={vi.fn(async () => undefined)}
      />,
    )

    // jsdom 没有排版引擎，量不到高度；这里只锁住“同一个操作容器”，
    // 等高的部分是 MaterialInspector.module.scss 里 .inspector-actions 的职责。
    const row = screen.getByLabelText('库位操作')
    expect(within(row).getByRole('button', { name: '查看占用物料' })).toBeInTheDocument()
    expect(within(row).getByRole('button', { name: '下料' })).toBeInTheDocument()
    expect(within(row).getAllByRole('button')).toHaveLength(2)
  })

  it('offers only unassigned non-structural materials when loading an empty site', async () => {
    const onChangeSite = vi.fn(async () => undefined)
    render(
      <MaterialInspector
        graph={graph}
        projection={projectionFor({ kind: 'site', siteUuid: 'L1C1' })}
        selection={{ kind: 'site', siteId: 'L1C1' }}
        onSelect={vi.fn()}
        onChangeSite={onChangeSite}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '上料' }))
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '选择待上料物料' }))
    expect(screen.getByText('待分配物料')).toBeInTheDocument()
    expect(screen.queryByText('L1C3 注粉瓶')).not.toBeInTheDocument()
    // 画布不展示的节点（virtual / logical mount / deck / host_node）不是可放置实例。
    expect(screen.queryByText('虚拟传送位')).not.toBeInTheDocument()
    expect(screen.queryByText('逻辑挂载位')).not.toBeInTheDocument()
    expect(screen.queryByText('host_node')).not.toBeInTheDocument()
    expect(screen.queryByText('聚合物工作站台面')).not.toBeInTheDocument()
  })

  it('reports the template restriction instead of offering unrelated materials', () => {
    render(
      <MaterialInspector
        graph={graph}
        projection={projectionFor({ kind: 'site', siteUuid: 'L1C2' })}
        selection={{ kind: 'site', siteId: 'L1C2' }}
        onSelect={vi.fn()}
        onChangeSite={vi.fn(async () => undefined)}
      />,
    )

    // L1C2 只接受 template-unused，图里没有任何节点使用该模板。
    fireEvent.click(screen.getByRole('button', { name: '上料' }))
    expect(screen.getByText('没有符合该库位模板限制的未分配物料。')).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: '选择待上料物料' })).not.toBeInTheDocument()
  })
})
