import { describe, expect, it } from 'vitest'

import type { HttpClient } from './http'
import { createDeviceSquareService } from './deviceSquare'

const templateUuid = '50afbb58-0f53-4ad6-9f73-24cfeb90a834'
const artifactDigest = `sha256:${'a'.repeat(64)}`

describe('设备广场 service adapter', () => {
  it('把分页筛选编码到现有公开列表接口并投影设备卡片', async () => {
    const requests: string[] = []
    const service = createDeviceSquareService(fixtureHttp({
      '/api/v1/lab/square/list?page=2&page_size=24&manufacturer_uuid=maker-1&keyword=pump&tags=liquid&tags=serial': {
        code: 0,
        data: {
          total: 1,
          page: 2,
          page_size: 24,
          data: [{
            uuid: templateUuid,
            name: 'pump',
            display_name: '蠕动泵',
            cover: '/cover.png',
            icon: '/icon.png',
            description: '测试泵',
            tags: ['liquid'],
            resource_type: 'device',
            created_at: '2026-08-05T00:00:00Z',
            manufacturer: {
              uuid: 'maker-1',
              name: '厂商',
              code: 'M1',
              website: 'https://maker.example'
            }
          }]
        }
      }
    }, requests))

    await expect(service.listDevices({
      page: 2,
      pageSize: 24,
      manufacturerUuid: 'maker-1',
      keyword: 'pump',
      tags: ['liquid', 'serial']
    })).resolves.toEqual({
      total: 1,
      page: 2,
      pageSize: 24,
      items: [{
        templateUuid,
        name: 'pump',
        displayName: '蠕动泵',
        cover: '/cover.png',
        icon: '/icon.png',
        description: '测试泵',
        tags: ['liquid'],
        resourceType: 'device',
        createdAt: '2026-08-05T00:00:00Z',
        manufacturer: {
          uuid: 'maker-1',
          name: '厂商',
          code: 'M1',
          website: 'https://maker.example'
        }
      }]
    })
    expect(requests).toEqual([
      '/api/v1/lab/square/list?page=2&page_size=24&manufacturer_uuid=maker-1&keyword=pump&tags=liquid&tags=serial'
    ])
  })

  it('重新读取详情并冻结 OS 下载需要的模板、definition 与摘要', async () => {
    const service = createDeviceSquareService(fixtureHttp({
      [`/api/v1/lab/square/detail/${templateUuid}`]: {
        code: 0,
        data: {
          uuid: templateUuid,
          name: 'pump',
          display_name: '蠕动泵',
          package_info: {
            name: 'review-lab',
            version: '1.2.0',
            class_namespace: 'community.review_lab',
            artifact_digest: artifactDigest,
            catalog_digest: `sha256:${'b'.repeat(64)}`
          },
          source_registry: {
            source_fqid: 'review_lab.devices.pump:Pump',
            package_definition_fqid: 'community.review_lab.pump'
          }
        }
      }
    }))

    await expect(
      service.resolvePackageCandidate(templateUuid)
    ).resolves.toEqual({
      templateUuid,
      definitionFqid: 'community.review_lab.pump',
      artifactDigest,
      packageName: 'review-lab',
      version: '1.2.0',
      classNamespace: 'community.review_lab',
      catalogDigest: `sha256:${'b'.repeat(64)}`
    })
  })

  it('遗留模板缺少摘要时失败关闭并提示使用当前 CLI 重发', async () => {
    const service = createDeviceSquareService(fixtureHttp({
      [`/api/v1/lab/square/detail/${templateUuid}`]: {
        code: 0,
        data: {
          uuid: templateUuid,
          name: 'legacy-pump',
          package_info: {
            class_namespace: 'community.review_lab'
          },
          source_registry: {
            source_fqid: 'review_lab.devices.pump:Pump',
            package_definition_fqid: 'community.review_lab.pump'
          }
        }
      }
    }))

    await expect(
      service.resolvePackageCandidate(templateUuid)
    ).rejects.toMatchObject({
      code: 'DEVICE_PACKAGE_INCOMPATIBLE',
      retryable: false
    })
  })

  /** 验证旧发布身份缺失与真正的命名空间不匹配使用不同诊断。 */
  it('把缺少 package_definition_fqid 的旧发布识别为旧版设备包', async () => {
    const service = createDeviceSquareService(fixtureHttp({
      [`/api/v1/lab/square/detail/${templateUuid}`]: {
        code: 0,
        data: {
          uuid: templateUuid,
          name: 'legacy-pump',
          package_info: {
            name: 'legacy-lab',
            version: '0.9.0',
            class_namespace: 'community.review_lab',
            artifact_digest: artifactDigest,
            catalog_digest: `sha256:${'b'.repeat(64)}`
          },
          source_registry: {
            source_fqid: 'review_lab.devices.pump:Pump'
          }
        }
      }
    }))

    await expect(
      service.resolvePackageCandidate(templateUuid)
    ).rejects.toMatchObject({
      code: 'DEVICE_PACKAGE_INCOMPATIBLE',
      message: expect.stringContaining('缺少 package_definition_fqid，属于旧版设备包'),
      retryable: false
    })
  })

  it('拒绝详情响应把请求模板替换成另一个 UUID', async () => {
    const service = createDeviceSquareService(fixtureHttp({
      [`/api/v1/lab/square/detail/${templateUuid}`]: {
        code: 0,
        data: {
          uuid: 'b78ecce2-aeee-477b-8981-78769f560e96',
          name: 'other-device'
        }
      }
    }))

    await expect(
      service.getDeviceDetail(templateUuid)
    ).rejects.toMatchObject({
      code: 'INVALID_DEVICE_SQUARE_RESPONSE',
      retryable: false
    })
  })

  it('复用现有包列表与包详情接口而不构造发布会话', async () => {
    const requests: string[] = []
    const service = createDeviceSquareService(fixtureHttp({
      '/api/v1/lab/square/packages': {
        code: 0,
        data: {
          data: [{
            name: 'review-lab',
            version: '1.2.0',
            source_type: 'community',
            source_url: 'https://source.example',
            install_spec: 'review-lab==1.2.0',
            device_count: 1
          }]
        }
      },
      '/api/v1/lab/square/packages/review-lab?page=1&page_size=24': {
        code: 0,
        data: {
          name: 'review-lab',
          version: '1.2.0',
          source_type: 'community',
          source_url: 'https://source.example',
          install_spec: 'review-lab==1.2.0',
          device_count: 1,
          summary: '测试设备包',
          license: 'MIT',
          homepage: 'https://package.example',
          class_namespace: 'community.review_lab',
          install_command: 'unilab package install review-lab==1.2.0',
          page: 1,
          page_size: 24,
          devices: [{ uuid: templateUuid, name: 'pump', tags: [] }]
        }
      }
    }, requests))

    await expect(service.listPackages()).resolves.toEqual([
      {
        name: 'review-lab',
        version: '1.2.0',
        sourceType: 'community',
        sourceUrl: 'https://source.example',
        installSpec: 'review-lab==1.2.0',
        deviceCount: 1
      }
    ])
    await expect(
      service.getPackageDetail('review-lab')
    ).resolves.toMatchObject({
      name: 'review-lab',
      classNamespace: 'community.review_lab',
      page: 1,
      pageSize: 24,
      devices: [{ templateUuid, name: 'pump' }]
    })
    expect(requests).toEqual([
      '/api/v1/lab/square/packages',
      '/api/v1/lab/square/packages/review-lab?page=1&page_size=24'
    ])
  })
})

/** 创建只接受冻结路径的 HttpClient，并记录每次请求。 */
function fixtureHttp(
  responses: Record<string, unknown>,
  requests: string[] = []
): HttpClient {
  return {
    /** 返回指定路径 fixture；未登记路径立即让测试失败。 */
    async request<ResponseValue>(path: string): Promise<ResponseValue> {
      requests.push(path)
      if (!Object.prototype.hasOwnProperty.call(responses, path)) {
        throw new Error(`unexpected request: ${path}`)
      }
      return responses[path] as ResponseValue
    }
  }
}
