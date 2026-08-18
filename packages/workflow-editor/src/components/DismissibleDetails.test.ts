import {
  closeDetailsOnEscape,
  closeDetailsOnOutsidePointer
} from '@unilab/design-system/hooks'
import { describe, expect, it, vi } from 'vitest'

describe('dismissible details menus', () => {
  /**
   * 证明点击下拉组件外部会收起菜单，内部交互仍可继续。
   *
   * @returns 无返回值；断言原生 details 的 open 状态。
   * @throws 当外点关闭或内点保留行为回归时由 Vitest 抛出。
   * @safety 仅使用内存替身，不访问真实页面或领域数据。
   */
  it('closes only for outside pointer interaction', () => {
    const insideTarget = {} as EventTarget
    const outsideTarget = {} as EventTarget
    const details = {
      open: true,
      contains: (target: Node): boolean => target === insideTarget
    }

    closeDetailsOnOutsidePointer(details, insideTarget)
    expect(details.open).toBe(true)

    closeDetailsOnOutsidePointer(details, outsideTarget)
    expect(details.open).toBe(false)
  })

  /**
   * 证明 Escape 会收起下拉菜单并把焦点归还给摘要按钮。
   *
   * @returns 无返回值；断言菜单状态与焦点回收次数。
   * @throws 当键盘关闭或焦点恢复回归时由 Vitest 抛出。
   * @safety 仅调用测试替身，不触发真实键盘事件或业务命令。
   */
  it('closes on Escape and restores summary focus', () => {
    const focus = vi.fn()
    const details = {
      open: true,
      querySelector: () => ({ focus })
    }

    closeDetailsOnEscape(details, 'Enter')
    expect(details.open).toBe(true)

    closeDetailsOnEscape(details, 'Escape')
    expect(details.open).toBe(false)
    expect(focus).toHaveBeenCalledOnce()
  })
})
