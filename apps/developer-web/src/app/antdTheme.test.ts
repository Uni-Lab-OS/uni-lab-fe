import { describe, expect, it } from 'vitest'
import { createAntdTheme } from '@unilab/design-v2'

/**
 * 按钮排版的唯一 owner 是 ConfigProvider 的 Button 令牌。
 *
 * 这条断言存在的理由：以前 `.ant-btn` 的字重被写了三处 ——
 * design-v2 的 antd adapter CSS、应用的共享控件层、以及若干页面自己的补丁。
 * 结果是同一屏里出现 14px/550、13px/600、12px/700 三种“看起来随机”的按钮，
 * 而每修一个地方就要再补一个地方。这里把契约钉死：令牌在，页面不再各自覆盖。
 */
describe('antd theme: button typography', () => {
  it('declares one regular-weight scale for every button size', () => {
    const theme = createAntdTheme(
      { resolvedMode: 'light' },
      { defaultAlgorithm: 'light', darkAlgorithm: 'dark' },
    )

    expect(theme.components.Button).toMatchObject({
      fontWeight: 400,
      contentFontSize: 14,
      contentFontSizeSM: 12,
      contentFontSizeLG: 14,
    })
    // antd 默认小号按钮与常规按钮同号，看起来“小按钮不小”；这里必须真的更小。
    expect(Number(theme.components.Button.contentFontSizeSM)).toBeLessThan(
      Number(theme.components.Button.contentFontSize),
    )
  })
})
