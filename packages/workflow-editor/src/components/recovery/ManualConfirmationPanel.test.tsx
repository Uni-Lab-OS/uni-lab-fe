import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WorkflowNodeJob, WorkflowRecoveryPort } from '@unilab/services'
import { ManualConfirmationPanel, confirmationActions, formatManualConfirmationDeadline } from './ManualConfirmationPanel'
import { parseManualParameters } from './ManualActionParameters'
const job = { uuid: 'job', workflow_node_uuid: 'node', manual_confirmation: { status: 'pending', actions: ['approve'] } } as WorkflowNodeJob

describe('人工确认节点操作', () => {

  it('将确认截止时间固定格式化为 YYYY-MM-DD HH:mm:ss', () => {
    const local = new Date(2026, 8, 17, 21, 18, 19)
    expect(formatManualConfirmationDeadline(local.toISOString()))
      .toBe('2026-09-17 21:18:19')
  })
  it('仅开放服务返回的操作，断线或确认结束后均禁止提交', () => {
    expect(confirmationActions(job, true)).toEqual(['approve'])
    expect(confirmationActions(job, false)).toEqual([])
    expect(confirmationActions({ ...job, manual_confirmation: { status: 'approved', actions: ['approve'] } }, true)).toEqual([])
    expect(confirmationActions({ ...job, manual_confirmation: { status: 'pending', actions: ['approve'], deadline_at: '2000-01-01T00:00:00Z' } }, true)).toEqual([])
  })
  it('展示节点和两种操作后果，不伪造成功状态', () => {
    const html = renderToStaticMarkup(<ManualConfirmationPanel jobs={[job]} names={{ node: '检查烧杯' }} port={{} as WorkflowRecoveryPort} writable refresh={vi.fn()} />)
    expect(html).toContain('检查烧杯 · 等待人工确认')
    expect(html).toContain('批准后继续执行')
    expect(html).toContain('拒绝将请求取消任务')
    expect(html).toMatch(/disabled="">拒绝/)
  })
  it('设备单点动作保留类型、必填、范围和 JSON 校验', () => {
    const action = { parameter_schema: { properties: { speed: { type: 'integer', minimum: 1 }, enabled: { type: 'boolean' } }, required: ['speed'] }, defaults: {} }
    expect(parseManualParameters(action, { speed: '10', enabled: 'false' }, '{}')).toEqual({ speed: 10, enabled: false })
    expect(() => parseManualParameters(action, { speed: '0' }, '{}')).toThrow('不能小于')
    expect(() => parseManualParameters(action, {}, '{}')).toThrow('请填写')
    expect(() => parseManualParameters(action, {}, '[]', true)).toThrow('JSON 对象')
  })
})
