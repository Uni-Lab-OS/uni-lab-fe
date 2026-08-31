import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  CreateExperimentOperationDialog,
  normalizeOperationCategories
} from './CreateExperimentOperationDialog'

describe('CreateExperimentOperationDialog', () => {
  it('renders the multi-category experiment operation contract', () => {
    const markup = renderToStaticMarkup(
      <CreateExperimentOperationDialog
        categorySuggestions={['样品前处理', '固体处理']}
        onCancel={vi.fn()}
        onCreate={vi.fn()}
      />
    )

    expect(markup).toContain('新建实验操作')
    expect(markup).toContain('<span>名称</span>')
    expect(markup).toContain('<span>分类</span>')
    expect(markup).toContain('aria-label="已有分类"')
    expect(markup).toContain('可选择多个，最多 20 个分类')
    expect(markup).toContain('<span>描述说明</span>')
    expect(markup).not.toContain('<span>标签</span>')
  })

  it('keeps category order while removing blanks and duplicates', () => {
    expect(normalizeOperationCategories([
      ' 样品前处理 ',
      '固体处理',
      '样品前处理',
      ''
    ])).toEqual(['样品前处理', '固体处理'])
  })
})
