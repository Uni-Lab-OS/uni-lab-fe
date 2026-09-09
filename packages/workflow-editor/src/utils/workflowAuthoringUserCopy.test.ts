import { describe, expect, it } from 'vitest'

import {
  authoringParameterLabel,
  formatAuthoringDiagnostic,
  formatAuthoringError
} from './workflowAuthoringUserCopy'

describe('workflowAuthoringUserCopy', () => {
  it('maps common parameter keys to Chinese labels', () => {
    expect(authoringParameterLabel('beaker')).toBe('烧杯')
    expect(authoringParameterLabel('sample')).toBe('样品')
  })

  it('rewrites missing required parameter errors for operators', () => {
    expect(formatAuthoringError('candidate_invalid: 动作缺少必填参数 beaker'))
      .toContain('烧杯')
    expect(formatAuthoringError('candidate_invalid: 动作缺少必填参数 beaker'))
      .toContain('草稿可以先保存')
    expect(formatAuthoringError('candidate_invalid: 动作缺少必填参数 beaker'))
      .not.toContain('candidate_invalid')
  })

  it('formats draft diagnostics without exposing raw codes as the title', () => {
    const copy = formatAuthoringDiagnostic({
      code: 'template_catalog_mismatch',
      message: '连接点模板目录语义已漂移: handle.beaker'
    })
    expect(copy.title).toBe('操作定义已更新')
    expect(copy.detail).toContain('重新拖入')
  })
})
