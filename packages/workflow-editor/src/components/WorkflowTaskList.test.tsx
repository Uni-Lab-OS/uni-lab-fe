import type { WorkflowRuntimePort } from '@unilab/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { WorkflowTaskList } from './WorkflowTaskList'

describe('WorkflowTaskList', () => {
  /** 首帧应立即提供任务页身份、筛选入口与诚实的加载状态。 */
  it('renders the Backend Task queue shell before the first response', () => {
    const markup = renderToStaticMarkup(
      <WorkflowTaskList
        runtime={{} as WorkflowRuntimePort}
        pollIntervalMs={0}
      />
    )

    expect(markup).toContain('工作流任务')
    expect(markup).toContain('搜索工作流、Task UUID 或状态')
    expect(markup).toContain('正在读取工作流任务')
    expect(markup).toContain('aria-label="工作流任务状态"')
  })
})
