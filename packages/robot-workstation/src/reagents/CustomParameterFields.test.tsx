import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { CustomParameterFields } from './CustomParameterFields'

describe('CustomParameterFields', () => {
  it('renders custom parameters as name/value pairs without a unit field', () => {
    const markup = renderToStaticMarkup(
      <CustomParameterFields
        value={[{ name: '纯度', value: '99.9%' }]}
        onChange={() => undefined}
      />
    )

    expect(markup).toContain('<span>名称</span>')
    expect(markup).toContain('<span>值</span>')
    expect(markup).not.toContain('<span>单位</span>')
  })
})
