import { describe, expect, it, vi } from 'vitest'

import {
  buildDownloadCommand,
  downloadDevicePackageWithCli,
  parseDownloadResult,
  removeDeviceWithCli,
  restoreDeviceGraphWithCli,
  stageDeviceWithCli,
  type DevicePackageCliCommandRunner,
  type DevicePackageCliConfig,
  type DevicePackageDownloadRequest
} from './devicePackageCli'

const digest = `sha256:${'a'.repeat(64)}`
const request: DevicePackageDownloadRequest = {
  templateUuid: '50afbb58-0f53-4ad6-9f73-24cfeb90a834',
  definitionFqid: 'community.review_lab.pump',
  artifactDigest: digest
}
const config: DevicePackageCliConfig = {
  unilabExecutable: '/opt/unilab/bin/unilab',
  commandWorkingDirectory: '/workspace/Uni-Lab-OS',
  managedWorkingDirectory: '/runtime/edge-local-debug',
  backendBaseUrl: 'https://backend.example/api/v1/'
}

describe('Electron Main 设备包 CLI 接口', () => {
  it('以无 shell argv 调用现有 Backend 地址和 OS 受管目录', () => {
    expect(buildDownloadCommand(config, request)).toEqual({
      command: '/opt/unilab/bin/unilab',
      cwd: '/workspace/Uni-Lab-OS',
      args: [
        '--working_dir',
        '/runtime/edge-local-debug',
        '--addr',
        'https://backend.example/api/v1',
        'package',
        'download',
        '--template-uuid',
        request.templateUuid,
        '--definition-fqid',
        request.definitionFqid,
        '--artifact-digest',
        digest,
        '--json'
      ]
    })
  })

  it('忽略前置状态日志并解析最后一行可信 JSON', () => {
    const output = [
      '当前工作目录为 /runtime/edge-local-debug',
      JSON.stringify(cliResult())
    ].join('\n')

    expect(parseDownloadResult(output, request)).toEqual({
      status: 'package_cached',
      cacheKey: `community.review_lab@1.2.0#${digest}`,
      cacheHit: false,
      distribution: 'review-lab',
      version: '1.2.0',
      namespace: 'community.review_lab',
      definitionFqid: 'community.review_lab.pump',
      catalogDigest: `sha256:${'b'.repeat(64)}`,
      configurationSchema: {
        type: 'object',
        required: ['endpoint'],
        properties: { endpoint: { type: 'string' } }
      }
    })
  })

  it('拒绝 CLI 返回另一 definition 或未绑定请求摘要的缓存身份', () => {
    expect(() => parseDownloadResult(JSON.stringify({
      ...cliResult(),
      definition_fqid: 'community.review_lab.balance'
    }), request)).toThrow('definition 身份不一致')
    expect(() => parseDownloadResult(JSON.stringify({
      ...cliResult(),
      cache_key: `community.review_lab@1.2.0#sha256:${'c'.repeat(64)}`
    }), request)).toThrow('未绑定请求 Artifact 摘要')
  })

  it('组合命令执行端口并返回可供配置向导使用的结果', async () => {
    const runner = vi.fn<DevicePackageCliCommandRunner>(async () => ({
      stdout: `${JSON.stringify(cliResult())}\n`,
      stderr: ''
    }))

    await expect(
      downloadDevicePackageWithCli(config, request, runner)
    ).resolves.toMatchObject({
      status: 'package_cached',
      definitionFqid: request.definitionFqid
    })
    expect(runner).toHaveBeenCalledWith(buildDownloadCommand(config, request))
  })

  /** 验证设备配置只能进入 stdin，永远不出现在可观察 argv。 */
  it('通过 stdin 写入设备配置并复核 OS 返回的稳定实例身份', async () => {
    const runner = vi.fn<DevicePackageCliCommandRunner>(async () => ({
      stdout: JSON.stringify(graphMutationResult('graph_staged')),
      stderr: ''
    }))

    const result = await stageDeviceWithCli(config, {
      cacheKey: `community.review_lab@1.2.0#${digest}`,
      definitionFqid: request.definitionFqid,
      instanceId: 'local_pump_1',
      instanceUuid: 'd4517ba4-4ce4-4b10-8954-05e35158d595',
      adoptExisting: true,
      graphPath: '/runtime/device-graph.json',
      displayName: '本地泵 1',
      configuration: { endpoint: 'serial:///dev/ttyUSB0' }
    }, runner)

    expect(result.status).toBe('graph_staged')
    const command = runner.mock.calls[0]?.[0]
    expect(command?.args).toContain('--config-stdin')
    expect(command?.args).toContain('--adopt-existing')
    expect(command?.args.join(' ')).not.toContain('ttyUSB0')
    expect(JSON.parse(command?.stdin ?? '')).toEqual({
      display_name: '本地泵 1',
      configuration: { endpoint: 'serial:///dev/ttyUSB0' }
    })

    await stageDeviceWithCli(config, {
      cacheKey: `community.review_lab@1.2.0#${digest}`,
      definitionFqid: request.definitionFqid,
      instanceId: 'local_pump_1',
      instanceUuid: 'd4517ba4-4ce4-4b10-8954-05e35158d595',
      adoptExisting: false,
      graphPath: '/runtime/device-graph.json',
      displayName: '本地泵 1',
      configuration: { endpoint: 'serial:///dev/ttyUSB0' }
    }, runner)
    expect(runner.mock.calls[1]?.[0].args).not.toContain('--adopt-existing')
  })

  /** 验证移除与恢复沿用固定设备图身份且解析可恢复备份。 */
  it('复用受管 working_dir 执行移除和设备图恢复', async () => {
    const runner = vi.fn<DevicePackageCliCommandRunner>(async (command) => ({
      stdout: JSON.stringify(graphMutationResult(
        command.args.includes('remove-device') ? 'removed' : 'graph_restored'
      )),
      stderr: ''
    }))

    await removeDeviceWithCli(config, {
      graphPath: '/runtime/device-graph.json',
      instanceId: 'local_pump_1',
      instanceUuid: 'd4517ba4-4ce4-4b10-8954-05e35158d595'
    }, runner)
    await restoreDeviceGraphWithCli(config, {
      graphPath: '/runtime/device-graph.json',
      backupPath: '/runtime/device-graph.json.unilab-backup-abc.json'
    }, runner)

    expect(runner.mock.calls[0]?.[0].args).toContain('remove-device')
    expect(runner.mock.calls[1]?.[0].args).toContain('restore-graph')
    expect(runner.mock.calls[1]?.[0].args).toContain(
      '/runtime/device-graph.json.unilab-backup-abc.json'
    )
  })
})

/** 生成与 OS package download 合同一致的最终 JSON fixture。 */
function cliResult(): Record<string, unknown> {
  return {
    status: 'package_cached',
    cache_key: `community.review_lab@1.2.0#${digest}`,
    cache_hit: false,
    distribution: 'review-lab',
    version: '1.2.0',
    namespace: 'community.review_lab',
    definition_fqid: 'community.review_lab.pump',
    catalog_digest: `sha256:${'b'.repeat(64)}`,
    configuration_schema: {
      type: 'object',
      required: ['endpoint'],
      properties: { endpoint: { type: 'string' } }
    }
  }
}

/** 生成与 OS 设备图变更合同一致的最终 JSON fixture。 */
function graphMutationResult(
  status: 'graph_staged' | 'removed' | 'graph_restored'
): Record<string, unknown> {
  return {
    status,
    instance_id: status === 'graph_restored' ? '' : 'local_pump_1',
    instance_uuid: status === 'graph_restored'
      ? ''
      : 'd4517ba4-4ce4-4b10-8954-05e35158d595',
    definition_fqid: status === 'graph_restored'
      ? ''
      : request.definitionFqid,
    graph_fingerprint: `sha256:${'c'.repeat(64)}`,
    backup_path: '/runtime/device-graph.json.unilab-backup-abc.json',
    changed: true
  }
}
