import { describe, expect, it, vi } from 'vitest'

import { transitionWorkbenchAuthority } from './workbench-authority-transition'

describe('transitionWorkbenchAuthority', () => {
  it('saves, replaces, activates and verifies Local content before Backend use', async () => {
    const calls: string[] = []
    await transitionWorkbenchAuthority({
      from: 'local',
      to: 'backend',
      operations: {
        saveWorkspace: vi.fn(async () => { calls.push('save') }),
        publishAndActivateBackend: vi.fn(async () => { calls.push('publish') }),
        switchAuthority: vi.fn(async () => { calls.push('switch') }),
        verifyAuthority: vi.fn(async () => { calls.push('verify') })
      },
      onPhase: phase => calls.push(`phase:${phase}`)
    })

    expect(calls).toEqual([
      'phase:saving', 'save',
      'phase:publishing', 'publish',
      'phase:verifying', 'verify'
    ])
  })

  it('force-switches without saving, publishing or verifying', async () => {
    const saveWorkspace = vi.fn(async () => undefined)
    const publishAndActivateBackend = vi.fn(async () => undefined)
    const verifyAuthority = vi.fn(async () => undefined)
    const switchAuthority = vi.fn(async () => undefined)

    await transitionWorkbenchAuthority({
      from: 'local',
      to: 'backend',
      force: true,
      operations: {
        saveWorkspace,
        publishAndActivateBackend,
        switchAuthority,
        verifyAuthority
      },
      onPhase: vi.fn()
    })

    expect(switchAuthority).toHaveBeenCalledWith('backend', { force: true })
    expect(saveWorkspace).not.toHaveBeenCalled()
    expect(publishAndActivateBackend).not.toHaveBeenCalled()
    expect(verifyAuthority).not.toHaveBeenCalled()
  })
})
