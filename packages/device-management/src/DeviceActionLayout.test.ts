import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('device action layout', () => {
  /** 证明长动作目录独立滚动，且参数区在桌面双栏中保持可见。 */
  it('keeps the parameter panel visible when the action catalog is long', () => {
    const styles = readFileSync(
      new URL('./DeviceManagementActions.module.scss', import.meta.url),
      'utf8'
    )

    expect(styles).toMatch(
      /\.edge-device__action-list\s*\{(?=[^}]*max-height:)(?=[^}]*overflow-y:\s*auto)[^}]*\}/s
    )
    expect(styles).toMatch(
      /\.edge-device__debug-section\s*\{(?=[^}]*position:\s*sticky)(?=[^}]*top:\s*0)[^}]*\}/s
    )
  })
})
