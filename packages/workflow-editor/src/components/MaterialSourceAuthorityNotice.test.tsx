import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { MaterialSourceAuthorityNotice } from './MaterialSourceAuthorityNotice'
it('retains the exact catalogue failure with a visible retry and expandable detail', () => {
  const problem = '物料来源目录加载失败：site exact-id.meta_data.rotation_deg_xyz must contain three finite numbers'
  const markup = renderToStaticMarkup(<MaterialSourceAuthorityNotice problem={problem} onRefresh={vi.fn()} />)
  expect(markup).toContain(problem)
  expect(markup).toContain('role="alert"')
  expect(markup).toContain('查看具体原因')
  expect(markup).toContain('重新读取目录')
  expect(renderToStaticMarkup(<MaterialSourceAuthorityNotice problem={null} onRefresh={vi.fn()} />)).toBe('')
})
