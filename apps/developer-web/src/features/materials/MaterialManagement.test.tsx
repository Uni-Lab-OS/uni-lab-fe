import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MaterialManagement } from './MaterialManagement'

describe('material management', () => {
  it('renders an explicit empty state instead of looping when the graph is unavailable', () => {
    // 回归：graph 缺失时 `graph?.nodes ?? []` 每次渲染都产生新数组，会让
    // nodes/treeData 与展开集 effect 每次都变化，触发 React 的
    // 「Maximum update depth exceeded」——表现为点开「物料管理」后整页空白。
    const onBack = vi.fn()
    render(<MaterialManagement graph={undefined} onBack={onBack} />)

    expect(screen.getByText('物料管理')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '返回物料关系图' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
