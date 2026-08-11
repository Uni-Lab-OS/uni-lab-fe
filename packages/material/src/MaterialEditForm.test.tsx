import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { MaterialEditForm } from './MaterialEditForm'
import { materialAggregate } from './testFixtures'

describe('MaterialEditForm', () => {
  /** 证明默认编辑体验是常用字段表单，原始 JSON 仅作为显式高级入口。 */
  it('renders a non-code editor before the advanced JSON editor', () => {
    const aggregate = materialAggregate('plate', {
      config: {
        batch: 'B-20260808',
        rows: 8,
        enabled: true,
        dimensionsMm: [127.8, 85.5, 14.4],
        rendering: { kind: 'plate' }
      }
    })

    const markup = renderToStaticMarkup(
      <MaterialEditForm
        aggregate={aggregate}
        status={{ available: false, reason: '当前服务不支持修改' }}
        pending={false}
        error={null}
        onCancel={() => undefined}
        onSave={async () => undefined}
      />
    )

    expect(markup).toContain('只修改当前物料实例')
    expect(markup).toContain('保存不会修改系统代码')
    expect(markup).toContain('常用配置')
    expect(markup).toContain('批次')
    expect(markup).toContain('多个数字请用逗号分隔')
    expect(markup).toContain('结构化配置')
    expect(markup).toContain('打开高级 JSON')
    expect(markup).not.toContain('完整配置 JSON')
  })
})
