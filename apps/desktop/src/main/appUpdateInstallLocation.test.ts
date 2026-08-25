import { describe, expect, it } from 'vitest'

import { resolveAppUpdateInstallBlocker } from './appUpdateInstallLocation'

describe('resolveAppUpdateInstallBlocker', () => {
  it('blocks a macOS application launched directly from a mounted DMG', () => {
    expect(resolveAppUpdateInstallBlocker({
      platform: 'darwin',
      executablePath: '/Volumes/UniLab Workbench 0.1.3-arm64/UniLab Workbench.app/Contents/MacOS/UniLab Workbench'
    })).toBe('INSTALL_FROM_DISK_IMAGE')
  })

  it('allows an installed macOS application and other platforms', () => {
    expect(resolveAppUpdateInstallBlocker({
      platform: 'darwin',
      executablePath: '/Applications/UniLab Workbench.app/Contents/MacOS/UniLab Workbench'
    })).toBeUndefined()
    expect(resolveAppUpdateInstallBlocker({
      platform: 'win32',
      executablePath: 'C:\\Program Files\\UniLab Workbench\\UniLab Workbench.exe'
    })).toBeUndefined()
  })
})
