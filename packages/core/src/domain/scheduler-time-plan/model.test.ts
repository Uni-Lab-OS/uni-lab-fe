import { describe, expect, it } from 'vitest'
import { decodeTimePlan } from './codec'
import { blockReasonKinds, stalledPlanNodes } from './model'

describe('stalled plan nodes', () => {
  const plan = decodeTimePlan({
    enabled: true,
    algorithm: 'CP-SAT',
    input: {
      revision: 'r1',
      blocked: [
        ['task-a', 'n1', 'condition_unresolved:x;loop_tail_unknown:y'],
        ['task-a', 'n2', '动作耗时尚无可用估计'],
        ['task-b', 'n3', 'human_confirmation_required:z'],
        ['task-b', 'n4', 'condition_unresolved:x;动作耗时尚无可用估计'],
      ],
    },
  })

  it('splits compound reasons into kinds', () => {
    expect(
      blockReasonKinds('condition_unresolved:a;condition_unresolved:b;loop_tail_unknown:c'),
    ).toEqual(['condition_unresolved', 'loop_tail_unknown'])
  })

  it('keeps only nodes the OS cannot schedule, optionally per task', () => {
    expect(stalledPlanNodes(plan).map((item) => item.nodeId)).toEqual(['n2', 'n4'])
    expect(stalledPlanNodes(plan, 'task-a').map((item) => item.nodeId)).toEqual(['n2'])
    expect(stalledPlanNodes(null)).toEqual([])
  })
})

describe('persistent stalls', () => {
  it('ignores blocks that disappear between reads and reports ones that persist', async () => {
    const { persistentStalls } = await import('./model')
    const seen = new Map<string, number>()
    const a = { taskId: 't', nodeId: 'a', reason: '已打开的连续资源区间缺少可继承所有权' }
    const b = { taskId: 't', nodeId: 'b', reason: '动作耗时尚无可用估计' }
    expect(persistentStalls([a, b], seen, 0, 60_000)).toEqual([])
    expect(persistentStalls([b], seen, 30_000, 60_000)).toEqual([])
    expect(persistentStalls([a, b], seen, 70_000, 60_000)).toEqual([b])
    expect(seen.has('t|a|已打开的连续资源区间缺少可继承所有权')).toBe(true)
  })
})
