import { describe, expect, it, vi } from 'vitest'

import type { WorkflowExecutableCatalogSnapshot } from './workflowActionCatalogTypes'
import {
  createWorkflowActionCatalogStore
} from './workflowActionCatalogStore'

describe('Authority 动作目录 Store', () => {
  it('失效发生在请求中途时不会把旧响应重新写回缓存', async () => {
    let finishFirst: (
      snapshot: WorkflowExecutableCatalogSnapshot
    ) => void = () => undefined
    const load = vi.fn()
      .mockImplementationOnce(() => new Promise<WorkflowExecutableCatalogSnapshot>(
        (resolve) => { finishFirst = resolve }
      ))
      .mockResolvedValueOnce(snapshot('new'))
    const store = createWorkflowActionCatalogStore(load)

    const first = store.read()
    store.invalidate()
    finishFirst(snapshot('old'))
    await first

    await expect(store.read()).resolves.toEqual(snapshot('new'))
    expect(load).toHaveBeenCalledTimes(2)
    store.dispose()
  })
})

function snapshot(authorityId: string): WorkflowExecutableCatalogSnapshot {
  return {
    authorityId,
    authorityKind: 'local',
    fingerprint: `sha256:${authorityId}`,
    actionTemplates: [],
    workflowTemplates: []
  }
}
