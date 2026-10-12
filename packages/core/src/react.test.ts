import { describe, expect, it } from 'vitest'
import { getRunPreparationReactStore } from './react'
import type { RunPreparationScenario } from './scenarios/run-preparation/scenario'

describe('getRunPreparationReactStore', () => {
  it('同一 scenario 与工作流返回同一个 store，保证返回页面后草稿仍在', () => {
    const scenario = {} as RunPreparationScenario

    expect(getRunPreparationReactStore(scenario, 'wf-1')).toBe(
      getRunPreparationReactStore(scenario, 'wf-1'),
    )
  })

  it('不同工作流或不同 scenario 之间互不共享', () => {
    const scenario = {} as RunPreparationScenario
    const other = {} as RunPreparationScenario

    expect(getRunPreparationReactStore(scenario, 'wf-1')).not.toBe(
      getRunPreparationReactStore(scenario, 'wf-2'),
    )
    expect(getRunPreparationReactStore(scenario, 'wf-1')).not.toBe(
      getRunPreparationReactStore(other, 'wf-1'),
    )
  })
})
