import { describe, expect, it } from 'vitest'

import { deviceInstanceOptionLabel } from './presentation'

describe('device card presentation', () => {
  it('shows the instance id when the OS label only describes its machine', () => {
    expect(deviceInstanceOptionLabel({
      deviceId: 'robot',
      label: '本地',
      online: true
    })).toBe('本地 · robot · 在线')
  })

  it('does not repeat the id when it is already the label', () => {
    expect(deviceInstanceOptionLabel({
      deviceId: 'robot',
      label: 'robot',
      online: false
    })).toBe('robot · 离线')
  })

  it('makes a malformed catalog entry explicit', () => {
    expect(deviceInstanceOptionLabel({
      deviceId: '',
      label: '本地',
      online: true
    })).toBe('本地 · 缺少 Device ID · 在线')
  })
})
