import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type {
  DeviceCardAgentEnvironmentInfo,
  DeviceCardWorkspaceStatus
} from '@unilab/device-card-sdk'
import type { DeviceCatalogItem, DeviceStatus } from '@unilab/services'

import {
  WorkbenchDeviceCardAgentTools,
  WorkbenchDeviceModeSwitcher,
  buildWorkbenchDeviceCardAuthoringContext,
  buildWorkbenchDeviceCardRuntimeState,
  buildWorkbenchDeviceCardAgentPrompt
} from './workbench-device-cards'

describe('Workbench 设备自定义卡片', () => {
  it('在仪器设备域公开设备控制和自定义卡片两个页签', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDeviceModeSwitcher mode="cards" onChange={vi.fn()} />
    )

    expect(markup).toContain('设备控制')
    expect(markup).toContain('自定义卡片')
    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-selected="true"')
  })

  it('按正式契约解码容器状态并附加 Host 状态', () => {
    const statusMap = new Map<string, DeviceStatus>([[
      'robot-1',
      {
        deviceId: 'robot-1',
        status: {
          pose: '{"x":1,"y":2}',
          untyped: '{"secret":true}'
        },
        timestamp: 1
      }
    ]])

    expect(buildWorkbenchDeviceCardRuntimeState(device(), statusMap)).toEqual({
      pose: { x: 1, y: 2 },
      untyped: '{"secret":true}',
      online: true,
      actionBusy: { move: false }
    })
  })

  it('从 OS 设备目录生成中立的卡片开发上下文', () => {
    const context = buildWorkbenchDeviceCardAuthoringContext(device(), {
      pose: { x: 1, y: 2 }
    })

    expect(context.deviceId).toBe('robot-1')
    expect(context.schemaVersion).toBe('device-card-authoring-context/v2')
    expect(context.deviceTypeId).toBe('community.robot_lab.robot')
    expect(context.actions).toEqual([
      expect.objectContaining({ action: 'move', label: '移动' })
    ])
    expect(context.sampleState).toEqual(expect.objectContaining({
      pose: { x: 1, y: 2 }
    }))
  })

  it('在 Workbench 公开 Agent CLI、桥接开关和复制指令入口', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchDeviceCardAgentTools
        info={agentInfo({ installed: false, compatible: false, enabled: false })}
        loading={false}
        error={null}
        ready={false}
        operation={null}
        workspaceOpen
        onRetry={vi.fn()}
        onToggleCli={vi.fn()}
        onToggleBridge={vi.fn()}
        onCopyPrompt={vi.fn()}
      />
    )

    expect(markup).toContain('Agent CLI')
    expect(markup).toContain('安装 Agent CLI')
    expect(markup).toContain('复制 AI 指令')
  })

  it('生成包含项目路径和受控检查命令的 AI 开发指令', () => {
    const prompt = buildWorkbenchDeviceCardAgentPrompt(
      workspace(),
      agentInfo({ installed: true, compatible: true, enabled: true })
    )

    expect(prompt).toContain('/tmp/robot-card')
    expect(prompt).toContain('workspace status')
    expect(prompt).toContain('authoring-context.json')
    expect(prompt).toContain('禁止直连设备或 WebSocket')
  })
})

/**
 * 构造 Workbench Agent 环境测试事实。
 *
 * @param input CLI 安装、兼容与 Bridge 启用状态。
 * @returns 可直接传入 Agent 工具区的环境快照。
 */
function agentInfo(input: {
  installed: boolean
  compatible: boolean
  enabled: boolean
}): DeviceCardAgentEnvironmentInfo {
  return {
    bridge: { enabled: input.enabled, protocolVersion: 1 },
    cli: {
      installed: input.installed,
      compatible: input.compatible,
      installPath: '/home/test/.local/bin/unilab-card-agent',
      onPath: true,
      command: '/home/test/.local/bin/unilab-card-agent'
    }
  }
}

/**
 * 构造复制 AI 开发指令所需的设备卡源码工作区。
 *
 * @returns 处于 ready 状态的固定源码工作区快照。
 */
function workspace(): DeviceCardWorkspaceStatus {
  return {
    schemaVersion: 'device-card-workspace-status/v1',
    state: 'ready',
    projectName: 'robot-card',
    projectDir: '/tmp/robot-card',
    revision: 1,
    updatedAt: '2026-08-13T00:00:00.000Z',
    diagnosticsPath: '/tmp/robot-card/.unilab-card/diagnostics.json',
    diagnostics: []
  }
}

/** 构造测试使用的设备目录条目。 */
function device(): DeviceCatalogItem {
  return {
    deviceId: 'robot-1',
    materialUuid: 'material-1',
    definitionFqid: 'community.robot_lab.robot',
    definition: {
      fqid: 'community.robot_lab.robot',
      version: '1.0.0',
      contentHash: `sha256:${'1'.repeat(64)}`,
      sourceIdentity: 'robot_lab.devices.robot:Robot',
      title: '机械臂',
      description: '机械臂设备定义',
      category: ['robot'],
      manufacturer: 'Uni-Lab',
      packageCatalog: {
        schemaVersion: '1',
        distribution: {
          name: 'robot-lab',
          normalizedName: 'robot_lab',
          version: '0.1.0'
        },
        importPackage: 'robot_lab',
        namespace: 'community.robot_lab',
        contentDigest: `sha256:${'2'.repeat(64)}`,
        catalogDigest: `sha256:${'3'.repeat(64)}`
      }
    },
    deviceTypeId: 'community.robot_lab.robot',
    deviceKey: 'robot-key',
    namespace: 'fixture',
    label: '机械臂 1',
    online: true,
    stateSchema: {
      pose: { type: 'object', source: 'driver', status: 'resolved' }
    },
    actions: [{
      actionName: 'move',
      actionRef: 'robot.move',
      label: '移动',
      typeName: 'Move',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      riskLevel: 'normal',
      isBusy: false
    }]
  }
}
