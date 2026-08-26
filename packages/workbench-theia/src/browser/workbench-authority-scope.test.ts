import { describe, expect, it } from 'vitest'

import { workbenchAuthorityScopeKey } from './workbench-authority-scope'

describe('workbenchAuthorityScopeKey', () => {
  /** 同一 Local 端口复用于不同工作区时，必须重建工作流面板并隔离最近选择。 */
  it('distinguishes workspaces that share the same local Backend address', () => {
    const first = workbenchAuthorityScopeKey(
      'local:http://127.0.0.1:18103',
      'C:\\Users\\tester\\workspace-a'
    )
    const second = workbenchAuthorityScopeKey(
      'local:http://127.0.0.1:18103',
      'C:\\Users\\tester\\workspace-b'
    )

    expect(first).not.toBe(second)
    expect(first).toBe(workbenchAuthorityScopeKey(
      'local:http://127.0.0.1:18103',
      'C:\\Users\\tester\\workspace-a'
    ))
  })
})
