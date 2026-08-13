import { describe, expect, it, vi } from 'vitest'

import {
  inspectDevicePackageWorkspace,
  inspectionFromCatalog,
  uploadDevicePackageWorkspace
} from './devicePackagePublishCli'
import type { DevicePackageCliCommandRunner } from './devicePackageCli'

const config = {
  unilabExecutable: '/opt/unilab/bin/unilab',
  commandWorkingDirectory: '/workspace/Uni-Lab-OS',
  managedWorkingDirectory: '/runtime/unilabos_data',
  backendBaseUrl: 'https://leap-lab.uat.bohrium.com/api/v1'
}

/** 覆盖 Electron Main 对现有设备包 inspect/upload CLI 的严格投影。 */
describe('设备包发布 CLI Adapter', () => {
  /** 验证检查结果只暴露用户确认发布所需的稳定摘要。 */
  it('把 PackageCatalog 收敛为包身份与定义摘要', () => {
    expect(inspectionFromCatalog(catalog())).toEqual({
      distribution: 'review-lab',
      version: '1.2.0',
      namespace: 'community.review_lab',
      catalogDigest: `sha256:${'b'.repeat(64)}`,
      devices: [{ fqid: 'community.review_lab.pump', displayName: 'Pump' }],
      resources: [],
      workflows: []
    })
  })

  /** 验证 Workspace 通过无 shell argv 交给 inspect 且不发生上传。 */
  it('只读检查用户选择的 Package Workspace', async () => {
    const runner = vi.fn<DevicePackageCliCommandRunner>(async () => ({
      stdout: `building\n${JSON.stringify(catalog())}\n`,
      stderr: ''
    }))

    await inspectDevicePackageWorkspace(config, '/workspace/package', runner)

    expect(runner).toHaveBeenCalledWith({
      command: config.unilabExecutable,
      cwd: config.commandWorkingDirectory,
      args: ['package', 'inspect', '--path', '/workspace/package', '--json']
    })
  })

  /** 验证上传凭据只进入 stdin，argv 只含固定环境地址和非秘密参数。 */
  it('通过 stdin 上传并解析稳定发布结果', async () => {
    const runner = vi.fn<DevicePackageCliCommandRunner>(async () => ({
      stdout: JSON.stringify({
        status: 'published',
        distribution: 'review-lab',
        version: '1.2.0',
        artifact_digest: `sha256:${'a'.repeat(64)}`
      }),
      stderr: ''
    }))

    await expect(uploadDevicePackageWorkspace(config, {
      workspacePath: '/workspace/package',
      cloudEnvironment: 'uat',
      ak: 'lab-access-key',
      sk: 'lab-secret-key'
    }, runner)).resolves.toEqual({
      status: 'published',
      cloudEnvironment: 'uat',
      distribution: 'review-lab',
      version: '1.2.0',
      artifactDigest: `sha256:${'a'.repeat(64)}`,
      visibleInSquare: false
    })
    expect(runner.mock.calls[0]?.[0]?.args).toEqual([
      '--working_dir',
      '/runtime/unilabos_data',
      '--addr',
      'https://leap-lab.uat.bohrium.com/api/v1',
      'package',
      'upload',
      '--path',
      '/workspace/package',
      '--auth-stdin',
      '--json'
    ])
    expect(runner.mock.calls[0]?.[0]?.args).not.toContain('lab-access-key')
    expect(runner.mock.calls[0]?.[0]?.args).not.toContain('lab-secret-key')
    expect(JSON.parse(runner.mock.calls[0]?.[0]?.stdin ?? '')).toEqual({
      schema_version: 'unilab-package-upload-auth/v1',
      ak: 'lab-access-key',
      sk: 'lab-secret-key'
    })
  })
})

/** 生成含一个设备定义的最小 PackageCatalog fixture。 */
function catalog(): Record<string, unknown> {
  return {
    namespace: 'community.review_lab',
    catalog_digest: `sha256:${'b'.repeat(64)}`,
    distribution: { name: 'review-lab', version: '1.2.0' },
    definitions: {
      devices: [{
        id: 'pump',
        fqid: 'community.review_lab.pump',
        title: 'Pump'
      }],
      resources: [],
      workflows: []
    }
  }
}
