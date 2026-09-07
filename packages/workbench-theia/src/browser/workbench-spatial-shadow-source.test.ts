import { describe, expect, it, vi } from 'vitest'

import {
  loadWorkbenchSpatialShadow,
  workbenchSpatialShadowUri
} from './workbench-spatial-shadow-source'

describe('Workbench spatial shadow source', () => {
  it('reads only the fixed snapshot path under the current workspace', () => {
    expect(workbenchSpatialShadowUri('/workspace/ptlc').path.toString()).toBe(
      '/workspace/ptlc/.unilab/spatial-shadow/current.v0.json'
    )
    expect(() => workbenchSpatialShadowUri('')).toThrow(
      'Workbench 尚未提供当前 workspace 路径'
    )
  })

  it('rejects malformed JSON without a fixture fallback', async () => {
    const read = vi.fn().mockResolvedValue({ value: '{broken' })
    await expect(loadWorkbenchSpatialShadow({ read } as never, '/workspace/ptlc'))
      .rejects.toThrow('空间 Shadow 快照校验失败')
    expect(read).toHaveBeenCalledOnce()
  })
})
