import type { Services } from '@unilab/services'
import { describe, expect, it, vi } from 'vitest'

import { createWorkbenchConnectionTargets } from './workbench-connection-profile'
import {
  WorkbenchAuthorityUnavailableError,
  preflightWorkbenchRuntimeAuthority
} from './workbench-domain-authority'

const targets = createWorkbenchConnectionTargets({
  managedLocalUrl: 'http://127.0.0.1:37029',
  browserOrigin: 'http://127.0.0.1:3100'
})

describe('Workbench contextual Domain Authority', () => {
  /** 候选 Authority 不健康时切换失败关闭，并且候选客户端仍会释放。 */
  it('rejects an unavailable target before the caller commits it', async () => {
    let selected: 'local' | 'backend' = 'local'
    const dispose = vi.fn()
    const candidate = candidateServices({ healthy: false, dispose })

    await expect(preflightWorkbenchRuntimeAuthority(
      targets.backend,
      () => candidate
    )).rejects.toBeInstanceOf(WorkbenchAuthorityUnavailableError)

    expect(selected).toBe('local')
    expect(dispose).toHaveBeenCalledOnce()
  })

  /** 健康且具备完整能力的目标通过预检后才允许一次性提交模式。 */
  it('allows an atomic commit after capability and readiness preflight', async () => {
    let selected: 'local' | 'backend' = 'local'
    const dispose = vi.fn()
    const candidate = candidateServices({ healthy: true, dispose })

    await preflightWorkbenchRuntimeAuthority(targets.backend, () => candidate)
    selected = 'backend'

    expect(selected).toBe('backend')
    expect(dispose).toHaveBeenCalledOnce()
  })

  /** 健康接口不能掩盖缺失的工作流目录，避免选择器进入不可用的本地模式。 */
  it('rejects a target whose workflow catalog cannot be read', async () => {
    const dispose = vi.fn()
    const candidate = candidateServices({
      healthy: true,
      dispose,
      workflowError: new Error('HTTP 404: Not Found')
    })

    await expect(preflightWorkbenchRuntimeAuthority(
      targets.local,
      () => candidate
    )).rejects.toThrow('工作流目录不可用')

    expect(dispose).toHaveBeenCalledOnce()
  })
})

function candidateServices(options: {
  healthy: boolean
  dispose: () => void
  workflowError?: Error
}): Services {
  return {
    getCapabilityStatus: () => ({ available: true }),
    laboratory: { ping: async () => options.healthy },
    workflow: {
      listWorkflows: async () => {
        if (options.workflowError) throw options.workflowError
        return { items: [], page: 1, page_size: 1, total: 0 }
      }
    },
    dispose: options.dispose
  } as unknown as Services
}
