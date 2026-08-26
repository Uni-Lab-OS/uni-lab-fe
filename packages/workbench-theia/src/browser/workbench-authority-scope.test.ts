import { describe, expect, it } from 'vitest'

import {
  workbenchAuthorityScopeKey,
  workbenchSessionScopeKey,
  workbenchWorkspaceScopeKey
} from './workbench-authority-scope'

describe('Workbench authority scope', () => {
  it('isolates persisted workflow selection by workspace on a reused port', () => {
    const target = 'local:http://127.0.0.1:18103'

    expect(workbenchWorkspaceScopeKey(target, '/workspace/a')).not.toBe(
      workbenchWorkspaceScopeKey(target, '/workspace/b')
    )
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

  it('keeps the existing authority key compatible with workspace scope', () => {
    const target = 'local:http://127.0.0.1:18103'
    const workspace = 'C:\\Users\\tester\\workspace-a'

    expect(workbenchAuthorityScopeKey(target, workspace)).toBe(
      workbenchWorkspaceScopeKey(target, workspace)
    )
  })
})
