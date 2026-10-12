import { beforeEach, describe, expect, it } from 'vitest'
import type { PreflightReport } from '@unilab-fe/core'
import {
  clearRunDraft,
  readDebugWorkflow,
  readRunDraft,
  writeDebugWorkflow,
  writeRunDraft,
} from './runDraftStorage'

const report = {
  kind: 'preflight_report',
  source: 'os',
  workflowUuid: 'wf-1',
  workflowRevision: 2,
  runMode: 'normal',
  status: 'blocked',
  canRun: false,
  checkedAt: '2026-10-12T08:00:00Z',
  checks: [],
} as unknown as PreflightReport

describe('runDraftStorage', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('保存并读回入参和检查结果', () => {
    writeRunDraft('/api', 'wf-1', {
      configuration: { runMode: 'normal', description: '任务', input: { sample_id: 'a' } },
      preflight: report,
    })

    const draft = readRunDraft('/api', 'wf-1')
    expect(draft?.configuration.input).toEqual({ sample_id: 'a' })
    expect(draft?.preflight?.checkedAt).toBe('2026-10-12T08:00:00Z')
  })

  it('不同后端地址和工作流之间互不可见', () => {
    writeRunDraft('/api', 'wf-1', { configuration: { runMode: 'normal', input: {} }, preflight: null })

    expect(readRunDraft('/other', 'wf-1')).toBeNull()
    expect(readRunDraft('/api', 'wf-2')).toBeNull()
  })

  it('损坏的内容和属于其他工作流的检查结果被忽略', () => {
    window.sessionStorage.setItem('unilab:run-draft:v1:/api:wf-1', '{bad')
    expect(readRunDraft('/api', 'wf-1')).toBeNull()

    writeRunDraft('/api', 'wf-9', {
      configuration: { runMode: 'normal', input: {} },
      preflight: report,
    })
    expect(readRunDraft('/api', 'wf-9')?.preflight).toBeNull()
  })

  it('可以清除草稿并记住调试中的工作流', () => {
    writeRunDraft('/api', 'wf-1', { configuration: { runMode: 'normal', input: {} }, preflight: null })
    clearRunDraft('/api', 'wf-1')
    expect(readRunDraft('/api', 'wf-1')).toBeNull()

    writeDebugWorkflow('/api', 'wf-1')
    expect(readDebugWorkflow('/api')).toBe('wf-1')
    writeDebugWorkflow('/api', null)
    expect(readDebugWorkflow('/api')).toBeNull()
  })
})
