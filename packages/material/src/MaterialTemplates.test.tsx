import {
  QueryClient,
  QueryClientProvider
} from '@tanstack/react-query'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MaterialCreateDialog } from './MaterialCreateDialog'
import {
  MaterialInstanceCreatePage,
  materialInstanceInitialConfig
} from './MaterialInstanceCreatePage'
import { MaterialTemplateCard } from './MaterialTemplateCard'
import { MaterialTemplateLibrary } from './MaterialTemplateLibrary'
import type {
  MaterialTemplateCatalogPort,
  MaterialTemplateDetail
} from './templateMaterial'

const TEMPLATE: MaterialTemplateDetail = {
  uuid: 'template-1',
  key: 'plate-96',
  sourceNamespace: 'unilabos',
  displayName: '96 Well Plate',
  kind: 'resource',
  tags: ['plate', 'liquid'],
  categoryPath: ['plates'],
  status: 'ready',
  contentHash: 'sha256:template-1',
  creation: {
    mode: 'resource-tree',
    available: false,
    reason: '当前 Edge 尚未开放物料创建'
  },
  containerLayout: {
    type: 'grid',
    containerKind: 'well',
    rows: ['A', 'B'],
    columns: 2,
    columnLabels: [1, 2],
    naming: 'row-column',
    geometry: {
      dimensionsMm: { x: 8, y: 8, z: 10 },
      depthMm: 10,
      shape: 'circle',
      pitchMm: { x: 9, y: -9 },
      offsetMm: { x: 10, y: 20, z: 2 },
      firstKey: 'A1'
    }
  },
  compatibility: {},
  configuration: { schema: {}, uiSchema: {} },
  assets: {}
}

/**
 * 忽略只读渲染测试中的关闭动作。
 * @returns 无返回值。
 */
const ignoreClose = (): void => undefined

/**
 * 忽略只读渲染测试中的物料实例创建草稿。
 * @param _draft 组件生成但本测试不提交的物料实例草稿。
 * @returns 无返回值。
 */
const ignoreCreate = (_draft: unknown): void => undefined

describe('material template components', () => {
  it('renders a template card in the Uni-Lab component vocabulary', () => {
    const markup = renderToStaticMarkup(
      <MaterialTemplateCard
        template={TEMPLATE}
        selected
        onSelect={() => undefined}
      />
    )

    expect(markup).toContain('96 Well Plate')
    expect(markup).toContain('plate · liquid')
    expect(markup).toContain('aria-pressed="true"')
  })

  it('keeps creation disabled without restoring Cloud liquid defaults', () => {
    const markup = renderToStaticMarkup(
      <MaterialCreateDialog
        template={TEMPLATE}
        existingNames={[]}
        createStatus={{
          available: false,
          reason: '当前 Go Backend 不支持原子创建'
        }}
        onCancel={() => undefined}
        onCreate={() => undefined}
      />
    )

    expect(markup).toContain('当前 Go Backend 不支持原子创建')
    expect(markup).toContain('disabled=""')
    expect(markup).not.toContain('Water 500')
  })

  it('shows a duplicate-name error instead of changing the name', () => {
    const markup = renderToStaticMarkup(
      <MaterialCreateDialog
        template={TEMPLATE}
        existingNames={['96 WELL PLATE']}
        createStatus={{ available: true }}
        onCancel={() => undefined}
        onCreate={() => undefined}
      />
    )

    expect(markup).toContain('当前物料图中已存在同名物料')
    expect(markup).toContain('aria-invalid="true"')
    expect(markup).not.toContain('96 Well Plate 2')
  })

  /** 证明新建实例页面继承批次，同时不伪造已放置或可分配状态。 */
  it('renders instance creation with inherited batch and unplaced truth', () => {
    const markup = renderToStaticMarkup(
      <MaterialInstanceCreatePage
        template={TEMPLATE}
        loadState="ready"
        initialBatch="B-20260808"
        existingNames={[]}
        createStatus={{ available: true }}
        onCancel={ignoreClose}
        onCreate={ignoreCreate}
      />
    )

    expect(markup).toContain('新建物料实例')
    expect(markup).toContain('B-20260808')
    expect(markup).toContain('暂不放置')
    expect(markup).toContain('不表示该实例可分配、已预留或已被任务使用')
  })

  /** 证明批次和有效期只以规范化非空字段进入实例配置。 */
  it('normalizes optional instance batch configuration', () => {
    expect(materialInstanceInitialConfig('  B-20260808  ', '2027-08-08'))
      .toEqual({ batch: 'B-20260808', expiresAt: '2027-08-08' })
    expect(materialInstanceInitialConfig('  ', '')).toEqual({})
  })

  it('does not query an unsupported template catalog', () => {
    const catalog: MaterialTemplateCatalogPort = {
      listTemplates: vi.fn(),
      getTemplate: vi.fn()
    }
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MaterialTemplateLibrary
          catalog={catalog}
          profileId="local-python"
          scope={{ kind: 'singleton' }}
          readStatus={{
            available: false,
            reason: '当前 Uni-Lab-OS 不支持模板目录'
          }}
          createStatus={{ available: false }}
          existingNames={[]}
          onCreate={() => undefined}
        />
      </QueryClientProvider>
    )

    expect(markup).toContain('模板目录不可用')
    expect(markup).toContain('当前 Uni-Lab-OS 不支持模板目录')
    expect(catalog.listTemplates).not.toHaveBeenCalled()
    expect(catalog.getTemplate).not.toHaveBeenCalled()
  })
})
