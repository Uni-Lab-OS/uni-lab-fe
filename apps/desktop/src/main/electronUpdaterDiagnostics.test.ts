import { describe, expect, it, vi } from 'vitest'

import { createElectronUpdaterDiagnostics } from './electronUpdaterDiagnostics'

describe('createElectronUpdaterDiagnostics', () => {
  it('records a successful differential download with exact transfer savings', () => {
    const log = vi.fn()
    const diagnostics = createElectronUpdaterDiagnostics(log)

    diagnostics.available('0.1.24', 665_157_321)
    diagnostics.started()
    diagnostics.logger.info(
      'Download block maps (old: "https://updates.example/0.1.23.zip.blockmap?token=old-secret", new: https://updates.example/0.1.24.zip.blockmap?token=new-secret)'
    )
    diagnostics.logger.info(
      'Full: 634.34 MB, To download: 12.00 MB (2%)'
    )
    diagnostics.logger.info(
      'Differential download: https://updates.example/0.1.24.zip?token=download-secret'
    )
    diagnostics.progress({ total: 12_582_912, transferred: 12_582_912 })
    diagnostics.completed('0.1.24')

    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'Workbench 更新下载开始: version=0.1.24 packageBytes=665157321',
      'Workbench 更新差分下载: 开始读取新旧 blockmap',
      'Workbench 更新差分下载计划: Full: 634.34 MB, To download: 12.00 MB (2%)',
      'Workbench 更新下载模式: mode=differential',
      'Workbench 更新下载完成: version=0.1.24 mode=differential packageBytes=665157321 transferredBytes=12582912 plannedTransferBytes=12582912 savedBytes=652574409 savedPercent=98.1'
    ])
    expect(log.mock.calls.flat().join('\n')).not.toMatch(/secret/u)
  })

  it('records a full download when macOS has no previous ZIP cache', () => {
    const log = vi.fn()
    const diagnostics = createElectronUpdaterDiagnostics(log)

    diagnostics.available('0.1.24', 665_157_321)
    diagnostics.started()
    diagnostics.logger.info(
      'Unable to locate previous update.zip for differential download (is this first install?), falling back to full download'
    )
    diagnostics.progress({ total: 665_157_321, transferred: 665_157_321 })
    diagnostics.completed('0.1.24')

    expect(log.mock.calls.map(([message]) => message)).toEqual([
      'Workbench 更新下载开始: version=0.1.24 packageBytes=665157321',
      'Workbench 更新下载模式: mode=full reason=missing_previous_cache',
      'Workbench 更新下载完成: version=0.1.24 mode=full packageBytes=665157321 transferredBytes=665157321 plannedTransferBytes=665157321 savedBytes=0 savedPercent=0.0'
    ])
  })

  it('records and sanitizes a differential fallback before full download', () => {
    const log = vi.fn()
    const diagnostics = createElectronUpdaterDiagnostics(log)

    diagnostics.available('0.1.24', 665_157_321)
    diagnostics.started()
    diagnostics.logger.error(
      'Cannot download differentially, fallback to full download: GET https://user:password@updates.example/0.1.23.zip.blockmap?token=secret failed'
    )

    expect(log).toHaveBeenLastCalledWith(
      'Workbench 更新下载模式: mode=full reason=differential_fallback detail=GET https://updates.example/0.1.23.zip.blockmap failed'
    )
  })

  it('keeps useful upstream messages but omits verbose debug logging', () => {
    const log = vi.fn()
    const diagnostics = createElectronUpdaterDiagnostics(log)

    diagnostics.logger.warn('Cannot parse blockmap "/tmp/current.blockmap"')

    expect(log).toHaveBeenCalledWith(
      'electron-updater warn: Cannot parse blockmap "/tmp/current.blockmap"'
    )
    expect(diagnostics.logger.debug).toBeUndefined()
  })
})
