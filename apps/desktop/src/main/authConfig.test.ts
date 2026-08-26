import { describe, expect, it } from 'vitest'

import {
  cloudApiRootUrl,
  cloudApiRootUrlForEnvironment,
  cloudServiceBaseUrl,
  cloudServiceBaseUrlForEnvironment,
  desktopAuthDefaults
} from './authConfig'

/** 覆盖 Cloud HTTP service 与 OS CLI 对同一配置地址的不同投影。 */
describe('Cloud API 地址投影', () => {
  it('按桌面发布通道冻结测试与生产登录环境', () => {
    expect(desktopAuthDefaults('test')).toEqual({
      OAUTH_URL: 'https://platform.test.bohrium.com',
      SITE_URL: 'https://leap-lab.test.bohrium.com/leap-lab',
      API_URL: 'https://leap-lab.test.bohrium.com/api/v1'
    })
    expect(desktopAuthDefaults('update-test')).toEqual({
      OAUTH_URL: 'https://platform.test.bohrium.com',
      SITE_URL: 'https://leap-lab.test.bohrium.com/leap-lab',
      API_URL: 'https://leap-lab.test.bohrium.com/api/v1'
    })
    expect(desktopAuthDefaults('production')).toEqual({
      OAUTH_URL: 'https://platform.bohrium.com',
      SITE_URL: 'https://leap-lab.bohrium.com/leap-lab',
      API_URL: 'https://leap-lab.bohrium.com/api/v1'
    })
  })

  /** 验证已带 `/api/v1` 的配置不会在 services 请求中重复路径。 */
  it('区分 service base 与 CLI API root', () => {
    expect(cloudServiceBaseUrl('https://cloud.example/api/v1'))
      .toBe('https://cloud.example')
    expect(cloudApiRootUrl('https://cloud.example/api/v1'))
      .toBe('https://cloud.example/api/v1')
    expect(cloudApiRootUrl('https://cloud.example'))
      .toBe('https://cloud.example/api/v1')
  })

  /** 验证部署路径前缀被保留且危险 URL 元素被拒绝。 */
  it('保留部署前缀并拒绝凭据或 query', () => {
    expect(cloudServiceBaseUrl('https://cloud.example/leap/api/v1/'))
      .toBe('https://cloud.example/leap')
    expect(() => cloudApiRootUrl('https://user:secret@cloud.example'))
      .toThrow('无凭据')
    expect(() => cloudApiRootUrl('https://cloud.example?target=other'))
      .toThrow('无凭据')
  })

  /** 验证用户可选的三套环境只映射到冻结的 Bohrium 部署地址。 */
  it('映射测试、UAT 与正式环境', () => {
    const previousOverride = process.env.PC_CLIENT_API_URL
    delete process.env.PC_CLIENT_API_URL
    try {
      expect(cloudApiRootUrlForEnvironment('test'))
        .toBe('https://leap-lab.test.bohrium.com/api/v1')
      expect(cloudApiRootUrlForEnvironment('uat'))
        .toBe('https://leap-lab.uat.bohrium.com/api/v1')
      expect(cloudServiceBaseUrlForEnvironment('production'))
        .toBe('https://leap-lab.bohrium.com')
    } finally {
      if (previousOverride === undefined) delete process.env.PC_CLIENT_API_URL
      else process.env.PC_CLIENT_API_URL = previousOverride
    }
  })
})
