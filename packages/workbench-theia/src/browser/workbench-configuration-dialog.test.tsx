import type { WorkbenchSessionSnapshot } from '@unilab/workbench-session'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  WorkbenchConfigurationDialog,
  type WorkbenchConfigurationOperations
} from './workbench-configuration-dialog'
import { WorkbenchTopBar } from './workbench-top-bar'

describe('Workbench mode configuration', () => {
  it('keeps simulation controls explicit without exposing an environment layer', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConfigurationDialog
        kind="simulation"
        session={sessionFixture()}
        operations={operationsFixture()}
        onClose={vi.fn()}
      />
    )

    expect(markup).toContain('仿真调试配置')
    expect(markup).toContain('启动 OS')
    expect(markup).toContain('启动 PLC-Sim')
    expect(markup).toContain('重置运行数据')
    expect(markup).not.toContain('运行环境')
  })

  it('configures Backend and Scheduler reachability in production mode', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchConfigurationDialog
        kind="production"
        session={sessionFixture()}
        operations={operationsFixture()}
        onClose={vi.fn()}
      />
    )

    expect(markup).toContain('Backend 地址')
    expect(markup).toContain('调度器（Scheduler）地址')
    expect(markup).toContain('一键测试连接')
    expect(markup).not.toContain('启动 OS')
  })

  it('shows mode-specific top navigation and workspace selection', () => {
    const debugMarkup = renderToStaticMarkup(
      <WorkbenchTopBar
        connectionMode="local"
        configurationKind={null}
        identityLabel="szlab · 调试模式"
        viewLabel="工作流"
        workspaceLabel="szlab"
        onConfigure={vi.fn()}
        onExitMode={vi.fn()}
        onOpenAssistant={vi.fn()}
      />
    )
    const productionMarkup = renderToStaticMarkup(
      <WorkbenchTopBar
        connectionMode="backend"
        configurationKind={null}
        identityLabel="szlab · 生产模式"
        viewLabel="工作流"
        workspaceLabel="szlab"
        onConfigure={vi.fn()}
        onExitMode={vi.fn()}
        onOpenAssistant={vi.fn()}
      />
    )

    expect(debugMarkup).toContain('助手')
    expect(debugMarkup).toContain('仿真调试')
    expect(debugMarkup).toContain('真实设备调试')
    expect(debugMarkup).toContain('退出调试模式')
    expect(debugMarkup).toContain('szlab')
    expect(productionMarkup).toContain('生产配置')
    expect(productionMarkup).toContain('退出生产模式')
    expect(productionMarkup).not.toContain('真实设备调试')
  })
})

/** 构造不启动进程的最小 WorkbenchSession 视图事实。 */
function sessionFixture(): WorkbenchSessionSnapshot {
  return {
    phase: 'ready',
    message: '工作台已就绪',
    configuredGraphPath: 'deployment/graphs/device-graph.json',
    configuredExternalDevicesOnly: true,
    configuredRuntimeMode: 'normal',
    configuredDomainMode: 'local',
    configuredBackendUrl: 'https://backend.example.com',
    configuredSchedulerUrl: 'https://scheduler.example.com',
    identity: null,
    agent: null,
    diagnostic: null,
    edgeRuntime: {
      phase: 'ready',
      message: 'OS 已启动',
      pid: 42,
      generation: 'edge-generation',
      graphPath: 'deployment/graphs/device-graph.json',
      mode: 'normal',
      logPath: '/workspace/.unilabos/os.log',
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
      logPath: '/workspace/.unilabos/plc-sim.log'
    }
  }
}

/** 构造只记录调用的配置边界，不访问 OS 或网络。 */
function operationsFixture(): WorkbenchConfigurationOperations {
  return {
    configureGraph: vi.fn(),
    setExternalDevicesOnly: vi.fn(),
    configurePlcSimulator: vi.fn(),
    setRuntimeMode: vi.fn(),
    startOs: vi.fn(),
    stopOs: vi.fn(),
    restartOs: vi.fn(),
    startPlcSimulator: vi.fn(),
    stopPlcSimulator: vi.fn(),
    resetRuntimeData: vi.fn(),
    configureProductionConnection: vi.fn(),
    probeProductionConnection: vi.fn(),
    enterMode: vi.fn()
  }
}
