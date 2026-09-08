import { describe, expect, it } from 'vitest'

import {
  isPlcConfigurationMissingError,
  PLC_CONFIGURATION_MISSING_CODE
} from './plc-configuration-error'

describe('PLC-Sim 配置缺失错误', () => {
  it('recognizes the Workspace Host missing-configuration code', () => {
    expect(isPlcConfigurationMissingError(
      new Error(`[${PLC_CONFIGURATION_MISSING_CODE}] 未配置 PLC-Sim 项目目录`)
    )).toBe(true)
    expect(isPlcConfigurationMissingError(
      new Error(`[${PLC_CONFIGURATION_MISSING_CODE}] 未配置 PLC-Sim 变量表`)
    )).toBe(true)
  })

  it('does not treat other PLC start failures as optional', () => {
    expect(isPlcConfigurationMissingError(
      new Error('[plc_project_invalid] PLC-Sim 项目无效')
    )).toBe(false)
    expect(isPlcConfigurationMissingError(
      new Error('未配置 PLC-Sim 项目目录')
    )).toBe(false)
  })
})
