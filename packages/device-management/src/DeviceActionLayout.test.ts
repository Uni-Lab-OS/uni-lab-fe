import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('device action layout', () => {
  /** 证明桌面动作区铺满剩余高度，长目录在面板内部独立滚动。 */
  it('fills the device workspace while keeping long action catalogs scrollable', () => {
    const shellStyles = readFileSync(
      new URL('./DeviceManagement.module.scss', import.meta.url),
      'utf8'
    )
    const styles = readFileSync(
      new URL('./DeviceManagementActions.module.scss', import.meta.url),
      'utf8'
    )

    expect(styles).toMatch(
      /\.edge-device__action-list\s*\{(?=[^}]*overflow-y:\s*auto)[^}]*\}/s
    )
    expect(styles).toMatch(
      /\.edge-device__content\s*\{(?=[^}]*flex:\s*1 1 auto)(?=[^}]*min-height:\s*0)[^}]*\}/s
    )
    expect(styles).toMatch(
      /\.edge-device__action-section \.edge-device__action-list\s*\{(?=[^}]*max-height:\s*none)(?=[^}]*flex:\s*1 1 auto)[^}]*\}/s
    )
    expect(styles).toMatch(
      /\.edge-device__debug-section\s*\{(?=[^}]*height:\s*100%)(?=[^}]*overflow-y:\s*auto)(?=[^}]*align-self:\s*stretch)[^}]*\}/s
    )
    expect(shellStyles).toMatch(
      /\.edge-device__workspace\s*\{(?=[^}]*height:\s*100%)(?=[^}]*flex-direction:\s*column)[^}]*\}/s
    )
  })
})
