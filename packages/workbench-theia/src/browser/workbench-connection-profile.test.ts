import { describe, expect, it } from 'vitest'

import {
  WORKBENCH_CONNECTION_STORAGE_KEY,
  createWorkbenchConnectionTargets,
  resolveInitialWorkbenchConnectionMode,
  serializeWorkbenchConnectionMode
} from './workbench-connection-profile'

describe('Workbench connection authority profile', () => {
  /** 证明 Workbench 默认选择常驻 Workspace Backend 的本地权威。 */
  it('defaults to the managed local authority', () => {
    expect(resolveInitialWorkbenchConnectionMode({
      search: '',
      storedMode: null
    })).toBe('local')
  })

  /** 证明用户显式选择优先于持久偏好，并兼容现有 backend 查询参数。 */
  it('gives an explicit Backend selection precedence over storage', () => {
    expect(resolveInitialWorkbenchConnectionMode({
      search: '?backend=local-go',
      storedMode: 'edge'
    })).toBe('backend')
    expect(resolveInitialWorkbenchConnectionMode({
      search: '?workbenchConnection=edge&backend=local-go',
      storedMode: 'backend'
    })).toBe('local')
  })

  /** 证明损坏的持久偏好失败关闭到 Local Authority，而不是猜测 Backend 权威。 */
  it('rejects an unknown stored authority value', () => {
    expect(resolveInitialWorkbenchConnectionMode({
      search: '',
      storedMode: 'automatic'
    })).toBe('local')
  })

  /** 证明两种选择装配不同服务 profile，并显式携带规范调度权威。 */
  it('creates isolated Local and Backend targets', () => {
    const targets = createWorkbenchConnectionTargets({
      managedLocalUrl: 'http://127.0.0.1:37029/',
      browserOrigin: 'http://127.0.0.1:3100'
    })

    expect(targets.local).toMatchObject({
      mode: 'local',
      authorityProfile: 'local_scheduler',
      backend: {
        id: 'local-python',
        apiUrl: 'http://127.0.0.1:3100/__unilab_local',
        realtimeUrl: 'ws://127.0.0.1:37029'
      }
    })
    expect(targets.backend).toMatchObject({
      mode: 'backend',
      authorityProfile: 'backend_controlled',
      backend: {
        id: 'local-go',
        apiUrl: 'http://127.0.0.1:3100/__unilab_backend'
      }
    })
    expect(targets.local.cacheKey).not.toBe(targets.backend.cacheKey)
    expect(targets.local.sourceId).toBe(
      'runtime:local:http://127.0.0.1:37029'
    )
    expect(targets.backend.sourceId).toBe(
      'runtime:backend:http://127.0.0.1:3100/__unilab_backend'
    )
    expect(targets.local.authoringSourceId).toBe(
      targets.backend.authoringSourceId
    )
  })

  /** 证明持久化格式只保存公开模式身份，不保存地址、令牌或任务身份。 */
  it('serializes only the selected mode', () => {
    expect(WORKBENCH_CONNECTION_STORAGE_KEY).toContain('connection-mode')
    expect(serializeWorkbenchConnectionMode('backend')).toBe('backend')
  })
})
