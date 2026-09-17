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

  it('物料源码身份错误不再误报为设备动作更新', () => {
    const copy = formatAuthoringDiagnostic({ code: 'template_catalog_mismatch', message: '物料来源资源模板 UUID 不能反解为当前源码身份' })
    expect(copy.title).toBe('物料来源模板不可用')
    expect(copy.detail).toContain('改选受支持的物料模板')
    expect(copy.detail).not.toContain('删掉')
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
