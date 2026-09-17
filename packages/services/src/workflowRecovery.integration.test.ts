import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getDefaultBackend } from './backends'
import { createHttpClient } from './http'
import { createWorkflowRuntime } from './workflow'
import { decisionIntent, sessionFields } from './workflowRecoveryContracts'

// 显式连接隔离的 OS 调度测试实例；正常单测不会访问或改变用户工作区。
const fixturePath = process.env.UNILAB_RECOVERY_FIXTURE
const endpoint = process.env.UNILAB_RECOVERY_TEST_URL
const fixture = fixturePath ? JSON.parse(readFileSync(fixturePath, 'utf8')) as { approve_job: string; reject_job: string; decision: string } : null

describe.skipIf(!fixture || !endpoint)('真实 OS HTTP 恢复契约（隔离模拟设备）', () => {
  it('批准、拒绝、幂等进入处置、完成处置和取消任务均通过公开接口', async () => {
    const backend = { ...getDefaultBackend(), apiUrl: endpoint! }
    const runtime = createWorkflowRuntime(createHttpClient({ backend }), backend)
    const recovery = runtime.recovery!
    try {
      expect((await runtime.getWorkflowNodeJob(fixture!.approve_job)).manual_confirmation?.status).toBe('pending')
      await recovery.confirmNode(fixture!.approve_job, 'approve')
      expect((await runtime.getWorkflowNodeJob(fixture!.approve_job)).manual_confirmation?.status).toBe('approved')
      await recovery.confirmNode(fixture!.reject_job, 'reject')
      expect((await runtime.getWorkflowNodeJob(fixture!.reject_job)).manual_confirmation?.status).toBe('rejected')
      await expect(recovery.confirmNode(fixture!.reject_job, 'approve')).rejects.toThrow()
      let snapshot = await recovery.loadStation()
      const error = snapshot.errors.find((item) => item.decision_id === fixture!.decision)!
      const enter = { ...decisionIntent(snapshot, error, 'enter_manual_handling', false, '隔离接口验证'), key: crypto.randomUUID(), label: '进入人工处置' }
      const accepted = await recovery.submit(enter)
      expect((await recovery.submit(enter)).command_uuid).toBe(accepted.command_uuid)
      expect((await recovery.loadCommand(accepted.command_uuid)).command_uuid).toBe(accepted.command_uuid)
      snapshot = await recovery.loadStation()
      expect(snapshot.active_session?.stage).toBe('MANUAL_HANDLING')
      const session = snapshot.active_session!
      expect((await recovery.loadInventory(session.session_id)).instances.length).toBeGreaterThan(0)
      expect(Array.isArray(await recovery.loadOccupancies())).toBe(true)
      await recovery.submit({ path: `/sessions/${session.session_id}/complete`, body: { ...sessionFields(snapshot, session), summary: '隔离验证完成' }, key: crypto.randomUUID(), label: '完成人工处置' })
      snapshot = await recovery.loadStation()
      expect(snapshot.active_session?.stage).toBe('DECISION_REQUIRED')
      expect(snapshot.mode).toBe('PAUSED')
      const cancel = decisionIntent(snapshot, snapshot.errors.find((item) => item.decision_id === fixture!.decision)!, 'cancel_task', false, '取消隔离测试任务')
      const result = await recovery.submit({ ...cancel, key: crypto.randomUUID(), label: '取消任务' })
      expect(result.status).toBe('APPLIED')
      expect((await recovery.loadStation()).mode).toBe('PAUSED')
    } finally { runtime.dispose() }
  })
})
