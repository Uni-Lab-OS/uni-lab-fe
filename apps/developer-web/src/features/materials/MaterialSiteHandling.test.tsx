// 应用入口靠这个补丁让 antd 静态确认框与消息在 React 19 下渲染，测试里同样需要。
import '@ant-design/v5-patch-for-react-19'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { App, Modal } from 'antd'
import type { MaterialGraphNode, SiteSummary } from '@unilab-fe/core'
import { SiteHandlingActions } from './MaterialSiteHandling'

const { holder } = vi.hoisted(() => ({
  holder: { current: null as unknown as ReturnType<typeof makeBackend> },
}))
vi.mock('../../app/BackendProvider', () => ({
  useBackend: () => ({ backend: holder.current }),
}))

function makeBackend(available: boolean) {
  return {
    getCapabilityStatus: () =>
      available ? { available: true } : { available: false, reason: '后端未声明人工上下料' },
    core: { materialSite: { updateSitePlacement: vi.fn(async () => ({})) } },
  }
}

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

afterEach(() => {
  Modal.destroyAll()
  cleanup()
})

describe('site handling actions', () => {
  it('下料先确认，再按读到的修订解除占用，并重读物料图', async () => {
    holder.current = makeBackend(true)
    const onChanged = vi.fn()
    const site = materialSite('staging-a', { occupied: 'tray-1' })
    render(
      <App>
        <SiteHandlingActions
          site={site}
          nodes={[graphNode('tray-1', 'collector-1', 5)]}
          onChanged={onChanged}
        />
      </App>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^下\s*料$/ }))
    expect(
      await screen.findAllByText('确认已把「collector-1」从「staging-a」取走？'),
    ).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '确认下料' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(holder.current.core.materialSite.updateSitePlacement).toHaveBeenCalledWith({
      materialUuid: 'tray-1',
      placement: { action: 'remove' },
      expectedRevision: 5,
    })
  })

  it('上料从候选里选物料放入空库位；提交失败也重读物料图', async () => {
    holder.current = makeBackend(true)
    holder.current.core.materialSite.updateSitePlacement.mockRejectedValueOnce(
      new Error('Material revision has changed'),
    )
    const onChanged = vi.fn()
    render(
      <App>
        <SiteHandlingActions
          site={materialSite('collector-1')}
          nodes={[graphNode('tray-1', 'collector-1', 7)]}
          onChanged={onChanged}
        />
      </App>,
    )
    fireEvent.click(screen.getByRole('button', { name: /^上\s*料$/ }))
    expect(await screen.findByText('collector-1（未放置）')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认上料' }))
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1))
    expect(holder.current.core.materialSite.updateSitePlacement).toHaveBeenCalledWith({
      materialUuid: 'tray-1',
      placement: { action: 'place', siteUuid: 'collector-1' },
      expectedRevision: 7,
    })
    expect(await screen.findByText(/Material revision has changed/)).toBeTruthy()
  })

  it('后端未声明能力时按钮禁用并说明原因', () => {
    holder.current = makeBackend(false)
    render(
      <App>
        <SiteHandlingActions
          site={materialSite('staging-a', { occupied: 'tray-1' })}
          nodes={[graphNode('tray-1', 'collector-1', 5)]}
          onChanged={() => undefined}
        />
      </App>,
    )
    expect(screen.getByRole('button', { name: /^下\s*料$/ }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('后端未声明人工上下料')).toBeTruthy()
  })
})

function materialSite(siteUuid: string, options: { occupied?: string } = {}): SiteSummary {
  return {
    kind: 'site',
    source: 'os',
    siteUuid,
    ownerMaterialUuid: 'store',
    key: siteUuid,
    name: siteUuid,
    sortOrder: null,
    allowedResourceTemplateUuids: null,
    occupancy: { known: true, occupiedMaterialUuid: options.occupied ?? null },
    geometry: null,
    metadata: {},
    raw: {},
  }
}

function graphNode(materialUuid: string, name: string, revision: number): MaterialGraphNode {
  return {
    material: {
      kind: 'material_summary',
      source: 'os',
      materialUuid,
      resourceTemplateUuid: 'tray-template',
      materialType: 'container',
      className: null,
      parentMaterialUuid: 'store',
      barcode: null,
      name,
      description: null,
      revision,
      config: {},
      metadata: {},
      createdAt: null,
      updatedAt: null,
      raw: {},
    },
    resourceTemplate: null,
    relativePosition: null,
    sites: [],
    currentSiteUuid: null,
    raw: {},
  }
}
