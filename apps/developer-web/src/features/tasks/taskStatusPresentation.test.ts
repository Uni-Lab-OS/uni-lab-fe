import { describe, expect, it } from 'vitest'
import { taskAttention } from './taskStatusPresentation'

describe('taskAttention labels', () => {
  it('labels OS reason codes that carry an id suffix', () => {
    expect(
      taskAttention({
        status: 'running',
        controlStatus: 'active',
        cleanupStatus: 'requires_attention',
        attentionReason: 'edge_reported_unknown_commands:11b20e42',
      }),
    ).toBe('待人工收尾：设备命令结果未知，需现场核对')
  })
})
