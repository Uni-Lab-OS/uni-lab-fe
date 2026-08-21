import { describe, expect, it } from 'vitest'

import { workbenchUserErrorMessage } from './workbench-user-error'

describe('workbenchUserErrorMessage', () => {
  it('explains an unavailable Backend without leaking diagnostics', () => {
    const message = workbenchUserErrorMessage(new Error(
      '[backend_authority_unavailable] Backend 运行环境 Edge 控制接口预检失败：' +
      '/api/v1/edge/sessions：<urlopen error [Errno 61] Connection refused>'
    ))

    expect(message).toBe(
      '目标 Backend 或 Scheduler 未启动，或当前无法访问。请确认服务已启动后重试。'
    )
    expect(message).not.toContain('authority')
    expect(message).not.toContain('/api/')
    expect(message).not.toContain('Errno')
  })

  it('turns an active-task block into an actionable explanation', () => {
    expect(workbenchUserErrorMessage(new Error(
      '[authority_tasks_active] 当前环境仍有 1 个活动任务'
    ))).toBe('当前环境存在活动任务。你可以先取消任务，再继续切换。')
  })

  it('hides an unsupported Backend task-status response', () => {
    const message = workbenchUserErrorMessage(new Error(
      'Backend GET /workflow-tasks 失败：Invalid request parameter: ' +
      'unsupported task status "admission_blocked"'
    ))

    expect(message).toBe(
      '目标 Backend 版本与当前工作台不兼容。请升级 Backend 后重试。'
    )
    expect(message).not.toContain('/workflow-tasks')
    expect(message).not.toContain('admission_blocked')
  })

  it('offers an actionable explanation for busy target Backend', () => {
    expect(workbenchUserErrorMessage(new Error(
      '[release_target_busy] 目标 Backend 仍有 1 个活动任务'
    ))).toBe('目标 Backend 存在活动任务。你可以先取消任务，再继续切换。')
  })
})
