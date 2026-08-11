import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createMaterialStore } from './store'
import { materialAggregate, materialGraphPort } from './testFixtures'
import {
  collectMaterialSubtreeIds,
  parseMaterialConfigText
} from './materialCrud'
import {
  MaterialInspector,
  MaterialInspectorOverview
} from './MaterialInspector'
import { MaterialStoreProvider } from './MaterialStoreProvider'

describe('MaterialInspector', () => {
  it('renders an accessible closeable drawer shell', () => {
    const store = createMaterialStore({
      scope: { kind: 'singleton' },
      graph: materialGraphPort(),
      requireCapability: () => undefined
    })

    const markup = renderToStaticMarkup(
      <MaterialStoreProvider store={store}>
        <MaterialInspector
          materialId="hotel"
          updateStatus={{
            available: false,
            reason: '当前服务不支持修改'
          }}
          deleteStatus={{
            available: false,
            reason: '当前服务不支持删除'
          }}
          onClose={() => undefined}
        />
      </MaterialStoreProvider>
    )

    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('unilab-slide-over__panel--default')
    expect(markup).toContain('aria-label="物料属性"')
    expect(markup).toContain('aria-label="关闭物料属性"')
    expect(markup).toContain('选择 2D 或 3D 中的物料查看详情')
  })

  /** 证明属性概览公开编辑、删除入口及各自的关闭失败原因。 */
  it('renders capability-gated update and delete actions', () => {
    const aggregate = materialAggregate('hotel', {
      config: { rows: 4 },
      placement: { kind: 'unplaced' }
    })
    aggregate.material.name = '样品库'

    const markup = renderToStaticMarkup(
      <MaterialInspectorOverview
        aggregate={aggregate}
        updateStatus={{ available: false, reason: '编辑契约未开放' }}
        deleteStatus={{ available: false, reason: '删除契约未开放' }}
        subtreeSize={1}
        pending={false}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onRequestPlacement={() => undefined}
      />
    )

    expect(markup).toContain('样品库')
    expect(markup).toContain('编辑契约未开放')
    expect(markup).toContain('删除契约未开放')
    expect(markup).toContain('配置')
    expect(markup).toContain('设置存储位置')
  })

  /** 证明配置编辑只接受 JSON 对象，拒绝数组和非法文本。 */
  it('validates editable Material config as a JSON object', () => {
    expect(parseMaterialConfigText('{"rows":4}')).toEqual({
      valid: true,
      value: { rows: 4 }
    })
    expect(parseMaterialConfigText('[]')).toMatchObject({ valid: false })
    expect(parseMaterialConfigText('{')).toMatchObject({ valid: false })
  })

  /** 证明删除影响范围沿稳定父子索引收集完整后代。 */
  it('collects deterministic Material subtree identities', () => {
    expect(
      collectMaterialSubtreeIds('root', {
        root: ['child-a', 'child-b'],
        'child-a': ['leaf']
      })
    ).toEqual(['root', 'child-a', 'leaf', 'child-b'])
  })
})
