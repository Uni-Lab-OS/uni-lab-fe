import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  captureWorkbenchUiOperation,
  runAndRefreshWorkbenchOperation,
  WorkbenchAuthorityLoading,
  WorkbenchSessionGate
} from './workbench-session-gate'

describe('WorkbenchSessionGate', () => {
  it('shows Workspace Backend loading while switching from Backend', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchAuthorityLoading mode="local" />
    )

    expect(markup).toContain('data-loading-kind="authority-switch"')
    expect(markup).toContain('data-authority-target="local"')
    expect(markup).toContain('正在切换到 Workspace Backend')
    expect(markup).toContain('正在连接 Workspace Backend，并恢复本地工作流与设备数据…')
  })

  it('turns a rejected UI operation into a visible error value', async () => {
    const errors: string[] = []

    await expect(captureWorkbenchUiOperation(
      async () => { throw new Error('fixture operation failed') },
      message => errors.push(message)
    )).resolves.toBeUndefined()

    expect(errors).toEqual(['fixture operation failed'])
  })

  it('refreshes the snapshot without swallowing an operation failure', async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const errors: string[] = []

    await captureWorkbenchUiOperation(
      () => runAndRefreshWorkbenchOperation(
        async () => { throw new Error('local reset is blocked') },
        refresh
      ),
      message => errors.push(message)
    )

    expect(refresh).toHaveBeenCalledOnce()
    expect(errors).toEqual(['local reset is blocked'])
  })

  it('keeps environment management reachable while OS readiness is blocked', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSessionGate
        snapshot={{
          phase: 'failed',
          message: 'PLC 连接失败，Uni-Lab OS 未就绪',
          configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
          configuredExternalDevicesOnly: true,
          configuredRuntimeMode: 'normal',
          configuredDomainMode: 'local',
          configuredBackendUrl: null,
          configuredSchedulerUrl: null,
          agent: null,
          identity: {
            workspacePath: '/workspace',
            osProjectPath: '/os',
            osRuntimeSource: 'checkout',
            environmentPath: '/python',
            graphPath: '/workspace/deployment/graphs/szlab-local-debug.json',
            graphFingerprint: 'graph',
            mode: 'normal',
            pid: 42,
            generation: 'generation',
            backendUrl: 'http://127.0.0.1:18103',
            logPath: '/workspace/.unilabos/logs/workbench/os.log',
            packageMounts: {
              schemaVersion: 'workspace-package-mounts/v1',
              editablePackageId: 'szlab',
              dependencyRevision: 'dependencies',
              catalogRevision: 'catalog',
              mountRevision: 'mounts',
              items: []
            },
            agent: null
          },
          diagnostic: {
            code: 'plc_connection_failed',
            message: '无法解析 PLC 的 OPC UA 主机名，OS 设备目录未完成初始化。',
            recovery: '检查设备图中的 PLC OPC UA 地址后重试'
          },
          edgeRuntime: {
            phase: 'failed',
            message: 'Edge Runtime 未就绪',
            pid: null,
            generation: null,
            graphPath: '/workspace/deployment/graphs/szlab-local-debug.json',
            mode: 'normal',
            logPath: '/workspace/.unilabos/logs/workbench/edge.log',
            diagnostic: '设备运行时未连接'
          },
          plcSimulator: {
            phase: 'idle',
            message: 'PLC-Sim 未启动',
            diagnostic: null,
            projectPath: '/workspace/PLC-Sim',
            variableTablePath: '/workspace/devices/plc/table.csv',
            variableTableCandidates: [],
            handshakeProfile: 'szlab',
            guiUrl: 'http://127.0.0.1:8080',
            opcUaUrl: 'opc.tcp://127.0.0.1:4840',
            pid: null,
            logPath: '/workspace/.unilabos/logs/plc-sim.log'
          }
        }}
        onRetry={vi.fn()}
        onStop={vi.fn()}
        connectionSelector={(
          <section aria-label="运行连接选择">连接 Backend</section>
        )}
        onOpenLog={vi.fn()}
        renderEnvironmentManager={onClose => (
          <section aria-label="本地运行与诊断">
            <button onClick={onClose}>关闭</button>
            <button>启动 PLC-Sim</button>
          </section>
        )}
      />
    )

    expect(markup).toContain('本地运行与诊断')
    expect(markup).toContain('<summary>技术详情</summary>')
    expect(markup).toContain('启动 PLC-Sim')
    expect(markup).toContain('PLC 连接失败')
    expect(markup).toContain('无法解析 PLC 的 OPC UA 主机名')
    expect(markup).toContain('建议：')
    expect(markup).toContain('<summary>技术信息</summary>')
    expect(markup).toContain('诊断代码：plc_connection_failed')
    expect(markup).toContain('unilab-workbench-session-actions')
    expect(markup).toContain('class="is-primary"')
    expect(markup).toContain('codicon-settings-gear')
    expect(markup).toContain('运行连接选择')
    expect(markup).toContain('在编辑器中打开日志文件')
    expect(markup).toContain('/workspace/.unilabos/logs/workbench/os.log')
  })

  it('covers the workbench with startup progress while the session starts', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSessionGate
        snapshot={{
          phase: 'starting',
          message: '正在校验工作区并启动 Uni-Lab OS…',
          configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
          configuredExternalDevicesOnly: true,
          configuredRuntimeMode: 'normal',
          configuredDomainMode: 'local',
          configuredBackendUrl: null,
          configuredSchedulerUrl: null,
          agent: null,
          identity: null,
          diagnostic: null,
          workflowLoadingProgress: { loaded: 7, total: 19 },
          edgeRuntime: {
            phase: 'idle',
            message: 'Edge Runtime 尚未启动',
            pid: null,
            generation: null,
            graphPath: 'deployment/graphs/szlab-local-debug.json',
            mode: 'normal',
            logPath: '',
            diagnostic: null
          },
          plcSimulator: {
            phase: 'idle',
            message: 'PLC-Sim 未启动',
            diagnostic: null,
            projectPath: '/workspace/PLC-Sim',
            variableTablePath: '/workspace/devices/plc/table.csv',
            variableTableCandidates: [],
            handshakeProfile: 'szlab',
            guiUrl: 'http://127.0.0.1:8080',
            opcUaUrl: 'opc.tcp://127.0.0.1:4840',
            pid: null,
            logPath: '/workspace/.unilabos/logs/plc-sim.log'
          }
        }}
        onRetry={vi.fn()}
        onStop={vi.fn()}
        renderEnvironmentManager={() => null}
      />
    )

    expect(markup).toContain('unilab-workbench-session-loading')
    expect(markup).toContain('正在启动 Unilab 调试工作台')
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('aria-valuenow="7"')
    expect(markup).toContain('aria-valuemax="19"')
    expect(markup).toContain('已加载 7 / 19 个工作流')
    expect(markup).toContain('width:37%')
    expect(markup).not.toContain('is-indeterminate')
    expect(markup).toContain('取消启动')
  })

  it('uses backend-specific copy while switching connections', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSessionGate
        snapshot={{
          phase: 'starting',
          message: '正在启动 Workspace Backend...',
          configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
          configuredExternalDevicesOnly: true,
          configuredRuntimeMode: 'normal',
          configuredDomainMode: 'backend',
          configuredBackendUrl: 'http://127.0.0.1:8080',
          configuredSchedulerUrl: null,
          agent: null,
          identity: null,
          diagnostic: null,
          edgeRuntime: {
            phase: 'idle',
            message: 'Edge Runtime 尚未启动',
            pid: null,
            generation: null,
            graphPath: 'deployment/graphs/szlab-local-debug.json',
            mode: 'normal',
            logPath: '',
            diagnostic: null
          },
          plcSimulator: {
            phase: 'idle',
            message: 'PLC-Sim 未启动',
            diagnostic: null,
            projectPath: '/workspace/PLC-Sim',
            variableTablePath: '/workspace/devices/plc/table.csv',
            variableTableCandidates: [],
            handshakeProfile: 'szlab',
            guiUrl: 'http://127.0.0.1:8080',
            opcUaUrl: 'opc.tcp://127.0.0.1:4840',
            pid: null,
            logPath: '/workspace/.unilabos/logs/plc-sim.log'
          }
        }}
        launchMode="backend"
        onRetry={vi.fn()}
        onStop={vi.fn()}
        renderEnvironmentManager={() => null}
      />
    )

    expect(markup).toContain('正在启动 Workspace')
    expect(markup).toContain('正在初始化工作区并连接 Backend…')
    expect(markup).not.toContain('工作流加载进度')
    expect(markup).toContain('取消启动')
  })

  it('uses the selected launch target instead of stale domain configuration', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchSessionGate
        snapshot={{
          phase: 'starting',
          message: '正在启动 Workspace Backend...',
          configuredGraphPath: 'deployment/graphs/szlab-local-debug.json',
          configuredExternalDevicesOnly: true,
          configuredRuntimeMode: 'normal',
          configuredDomainMode: 'backend',
          configuredBackendUrl: 'http://127.0.0.1:8080',
          configuredSchedulerUrl: null,
          agent: null,
          identity: null,
          diagnostic: null,
          edgeRuntime: {
            phase: 'idle',
            message: 'Edge Runtime 尚未启动',
            pid: null,
            generation: null,
            graphPath: 'deployment/graphs/szlab-local-debug.json',
            mode: 'normal',
            logPath: '',
            diagnostic: null
          },
          plcSimulator: {
            phase: 'idle',
            message: 'PLC-Sim 未启动',
            diagnostic: null,
            projectPath: '/workspace/PLC-Sim',
            variableTablePath: '/workspace/devices/plc/table.csv',
            variableTableCandidates: [],
            handshakeProfile: 'szlab',
            guiUrl: 'http://127.0.0.1:8080',
            opcUaUrl: 'opc.tcp://127.0.0.1:4840',
            pid: null,
            logPath: '/workspace/.unilabos/logs/plc-sim.log'
          }
        }}
        launchMode="local"
        onRetry={vi.fn()}
        onStop={vi.fn()}
        renderEnvironmentManager={() => null}
      />
    )

    expect(markup).toContain('正在启动 Unilab 调试工作台')
    expect(markup).toContain('正在启动 Workspace Backend...')
    expect(markup).toContain('role="progressbar"')
    expect(markup).toContain('is-indeterminate')
    expect(markup).toContain('正在初始化后端并发现工作流…')
    expect(markup).not.toContain('aria-valuenow')
    expect(markup).not.toContain('正在启动 Backend 模式')
  })
})
