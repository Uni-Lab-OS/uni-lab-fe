import { describe, expect, it } from 'vitest'

import {
  workbenchAuthorityScopeKey,
  workbenchSessionScopeKey,
  workbenchWorkspaceScopeKey
} from './workbench-authority-scope'

describe('Workbench authority scope', () => {
  it('isolates persisted workflow selection by workspace on a reused port', () => {
    const target = 'local:http://127.0.0.1:18103'
    const first = workbenchWorkspaceScopeKey(
      target,
      'C:\\Users\\tester\\workspace-a'
    )
    const second = workbenchWorkspaceScopeKey(
      target,
      'C:\\Users\\tester\\workspace-b'
    )

    expect(first).not.toBe(second)
    expect(first).toBe(workbenchAuthorityScopeKey(
      target,
      'C:\\Users\\tester\\workspace-a'
    ))
  })

  it('rebuilds transient state when the same workspace starts a new session', () => {
    const target = 'local:http://127.0.0.1:18103'
    const first = workbenchSessionScopeKey(
      target,
      '/workspace/a',
      'generation-a'
    )
    const second = workbenchSessionScopeKey(
      target,
      '/workspace/a',
      'generation-b'
    )

    expect(first).not.toBe(second)
    expect(first).toBe(workbenchSessionScopeKey(
      target,
      '/workspace/a',
      'generation-a'
    ))
  })
})
