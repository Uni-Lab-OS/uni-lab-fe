import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PageHeader } from './PageHeader'
import { TableText } from './TableText'

describe('basic developer-web UI', () => {
  it('renders page header with leading and actions', () => {
    render(<PageHeader title="设备" leading={<span>返回</span>} actions={<button>新增</button>} />)
    expect(screen.getByRole('heading', { name: '设备' })).toBeInTheDocument()
    expect(screen.getByText('返回')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '新增' })).toBeInTheDocument()
  })

  it('renders table text with tooltip content and style overrides', () => {
    render(<TableText text="很长的文本" className="extra" style={{ color: 'red' }} />)
    const text = screen.getByText('很长的文本')
    expect(text).toHaveClass('extra')
    expect(text).toHaveStyle({ color: 'rgb(255, 0, 0)', display: 'block', maxWidth: '100%' })
  })
})
