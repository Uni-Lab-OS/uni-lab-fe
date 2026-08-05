import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type {
  LocalRuntimeLaunchConfig,
  LocalRuntimeLogsSnapshot,
  LocalRuntimeSnapshot
} from '../types/electron'
import {
  detectPhoenixObservabilityDependencyIssue,
  LocalRuntimeDialog,
  LocalRuntimeLogDrawer,
  normalizeStoredLocalRuntimeConfig,
  validateEdgeConfig,
  validateSimulatorConfig
} from './LocalRuntimeLauncher'

const idleSnapshot: LocalRuntimeSnapshot = {
  phase: 'idle',
  message: 'PLC-Sim 与领域侧 Edge 均未启动',
  simulatorRunning: false,
  bridgeRunning: false,
  edgeRunning: false
}

const baseConfig: LocalRuntimeLaunchConfig = {
  graphPath: '/tmp/device.json',
  osProjectPath: '/tmp/Uni-Lab-OS',
  szlabProjectPath: '/tmp/Uni-Lab-SZLab',
  environmentPath: '/tmp/envs/unilab',
  simulatorProjectPath: '/tmp/PLC-Sim',
  edgeCommandMode: 'generated',
  customEdgeCommand: {
    executable: '',
    args: []
  }
}

describe('LocalRuntimeLauncher', () => {
  it('validates PLC-Sim and Edge as independent launch forms', () => {
    expect(validateSimulatorConfig({
      ...baseConfig,
      simulatorProjectPath: ''
    }).errors.simulatorProjectPath).toBeTruthy()
    expect(validateEdgeConfig({
      ...baseConfig,
      simulatorProjectPath: ''
    })).toEqual({ valid: true, errors: {} })
    expect(validateSimulatorConfig({
      ...baseConfig,
      graphPath: '',
      osProjectPath: '',
      szlabProjectPath: ''
    })).toEqual({ valid: true, errors: {} })
    expect(validateEdgeConfig({
      ...baseConfig,
      szlabProjectPath: ''
    })).toEqual({ valid: true, errors: {} })
  })

  it('renders separate PLC and Edge controls with the variable-table reminder', () => {
    const markup = renderDialog(baseConfig, idleSnapshot)
    const headerMarkup = markup.match(/<header[^>]*>.*?<\/header>/s)?.[0] ?? ''
    const footerMarkup = markup.match(/<footer[^>]*>.*?<\/footer>/s)?.[0] ?? ''

    expect(markup).toContain('PLC-Sim（可选）')
    expect(markup).toContain('启动领域侧本地调试环境（以 sz_lab 为例）')
    expect(markup).toContain('领域侧 Edge（以 sz_lab 为例）')
    expect(markup).toContain('领域项目根目录（可选，以 Uni-Lab-SZLab 为例）')
    expect(markup).toContain('留空时仅加载 Uni-Lab-OS 内置设备能力')
    expect(markup).toContain('领域设备图 JSON（以 sz_lab 为例）')
    expect(markup).toContain('启动 PLC')
    expect(markup).toContain('启动 Edge')
    expect(markup).toContain('使用 PLC 时，请先上传变量表')
    expect(markup).toContain(
      '先启动 PLC-Sim，在 PLC-Sim 中上传 PLC 变量表，确认完成后再启动领域侧 Edge。'
    )
    expect(markup).not.toContain('启动 SZLab 本地调试环境')
    expect(markup).not.toContain('同时启动本地 OPC UA')
    expect(markup).not.toContain('Bridge')
    expect(markup).toContain('id="runtime-environment-path" type="button"')
    expect(markup).toContain('id="runtime-graph-path" type="button"')
    expect(markup).toContain('id="runtime-os-path" type="text"')
    expect(markup).toContain('id="runtime-szlab-path" type="text"')
    expect(markup).toContain('id="runtime-simulator-path" type="text"')
    expect(markup.match(/<input/g)).toHaveLength(5)
    expect(headerMarkup).toContain('查看日志')
    expect(footerMarkup).not.toContain('查看日志')
  })

  it('keeps Edge available after PLC starts and reminds the user to upload variables', () => {
    const markup = renderDialog(baseConfig, {
      ...idleSnapshot,
      phase: 'simulator_ready',
      message: 'PLC-Sim 已就绪；请上传 PLC 变量表后再启动领域侧 Edge',
      simulatorRunning: true
    })

    expect(markup).toContain('停止 PLC')
    expect(markup).toContain('启动 Edge')
    expect(markup).toContain('请上传 PLC 变量表后再启动领域侧 Edge')
    expect(markup).toMatch(/data-status="running"[^>]*>.*PLC-Sim/s)
    expect(markup).toMatch(/data-status="idle"[^>]*>.*领域侧 Edge/s)
  })

  /** 证明挂载领域设备包后优先展示必要输入，并把技术细节渐进披露。 */
  it('renders a focused custom Edge command form for a domain package', () => {
    const config: LocalRuntimeLaunchConfig = {
      ...baseConfig,
      edgeCommandMode: 'custom',
      customEdgeCommand: {
        executable: '{{python}}',
        args: ['-m', 'unilabos.app.main', '--workspace', '{{workspace}}']
      }
    }

    const markup = renderDialog(config, idleSnapshot)

    expect(markup).toContain('选择启动程序，并按实际顺序填写参数')
    expect(markup).toContain('启动程序')
    expect(markup).toContain('启动参数')
    expect(markup).toContain('每行一个参数')
    expect(markup).toContain('{{workspace}}')
    expect(markup).toContain('填入默认命令')
    expect(markup).toContain('高级设置')
    expect(markup).toContain('占位符、命令预览与兼容说明')
    expect(markup).toContain('最终命令预览')
    expect(markup).not.toMatch(/<details[^>]*\sopen(?:=|>)/)
    expect(markup).toContain('&quot;unilabos.app.main&quot;')
  })

  /** 证明自定义命令在缺少领域设备包或可执行文件时失败关闭。 */
  it('fails closed when a custom Edge command is incomplete', () => {
    const validation = validateEdgeConfig({
      ...baseConfig,
      szlabProjectPath: '',
      edgeCommandMode: 'custom',
      customEdgeCommand: { executable: '', args: [] }
    })

    expect(validation.valid).toBe(false)
    expect(validation.errors.szlabProjectPath).toContain('领域设备包')
    expect(validation.errors.customEdgeExecutable).toContain('可执行文件')
  })

  /** 证明 v1/v2 路径配置迁移后继续使用系统生成的 Edge 启动计划。 */
  it('migrates legacy stored paths without freezing a custom command', () => {
    expect(normalizeStoredLocalRuntimeConfig({
      graphPath: '/legacy/device.json',
      osProjectPath: '/legacy/Uni-Lab-OS',
      szlabProjectPath: '/legacy/Uni-Lab-SZLab',
      environmentPath: '/legacy/envs/unilab',
      simulatorProjectPath: '/legacy/PLC-Sim'
    })).toEqual({
      graphPath: '/legacy/device.json',
      osProjectPath: '/legacy/Uni-Lab-OS',
      szlabProjectPath: '/legacy/Uni-Lab-SZLab',
      environmentPath: '/legacy/envs/unilab',
      simulatorProjectPath: '/legacy/PLC-Sim',
      edgeCommandMode: 'generated',
      customEdgeCommand: { executable: '', args: [] }
    })
  })

  it('prevents PLC changes while Edge is running', () => {
    const markup = renderDialog(baseConfig, {
      ...idleSnapshot,
      phase: 'ready',
      message: 'PLC-Sim 与领域侧 Edge 已就绪',
      simulatorRunning: true,
      bridgeRunning: true,
      edgeRunning: true
    })

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>停止 PLC<\/button>/)
    expect(markup).toContain('停止 Edge')
    expect(markup.match(/>运行中<\/span>/g)).toHaveLength(2)
  })

  it('shows the current single-process Edge as running without a local bridge', () => {
    const markup = renderDialog(baseConfig, {
      ...idleSnapshot,
      phase: 'ready',
      message: '领域侧 Edge 已就绪',
      edgeRunning: true
    })

    expect(markup).toMatch(/data-status="running"[^>]*>.*领域侧 Edge/s)
    expect(markup).toContain('HTTP 18003')
    expect(markup).not.toContain('8014')
    expect(markup).not.toContain('WS 8892')
  })

  it('shows Edge as starting while its internal service initializes', () => {
    const markup = renderDialog(baseConfig, {
      ...idleSnapshot,
      phase: 'waiting_bridge',
      message: '领域侧 Edge 正在初始化本地服务…',
      bridgeRunning: true
    })

    expect(markup).toMatch(/data-status="starting"[^>]*>.*领域侧 Edge/s)
    expect(markup).toContain('正在启动…')
    expect(markup).not.toContain('Bridge')
  })

  it('detects the missing Phoenix dependency only with the matching OTLP 503', () => {
    const launchMarker = '[launcher] 2026-08-04T03:12:00.000Z starting'
    const missingPhoenix =
      'Phoenix trace 日志服务启动失败：未安装 Arize Phoenix'
    const otlpUnavailable =
      'POST /api/v1/observability/otlp/v1/traces HTTP/1.1 503 Service Unavailable'

    expect(detectPhoenixObservabilityDependencyIssue([
      launchMarker,
      missingPhoenix,
      otlpUnavailable
    ].join('\n'))).toBe(true)
    expect(detectPhoenixObservabilityDependencyIssue([
      launchMarker,
      missingPhoenix
    ].join('\n'))).toBe(false)
    expect(detectPhoenixObservabilityDependencyIssue([
      launchMarker,
      otlpUnavailable
    ].join('\n'))).toBe(false)
  })

  it('ignores a Phoenix failure left over from an earlier Edge launch', () => {
    expect(detectPhoenixObservabilityDependencyIssue([
      '[launcher] 2026-08-04T03:10:00.000Z starting',
      'Phoenix trace 日志服务启动失败：未安装 Arize Phoenix',
      'POST /api/v1/observability/otlp/v1/traces HTTP/1.1 503',
      '[launcher] process exited code=0 signal=null',
      '[launcher] 2026-08-04T03:12:00.000Z starting',
      '26-08-04 [11:12:03,100] [INFO] Phoenix trace 日志服务已就绪'
    ].join('\n'))).toBe(false)
  })

  it('renders an actionable non-blocking Phoenix recovery notice', () => {
    const markup = renderDialog(baseConfig, {
      ...idleSnapshot,
      phase: 'ready',
      message: '领域侧 Edge 已就绪',
      edgeRunning: true
    }, true)

    expect(markup).toContain('链路追踪（Trace）功能已降级')
    expect(markup).toContain('设备与业务运行不受影响')
    expect(markup).toContain("cd &#x27;/tmp/Uni-Lab-OS&#x27;")
    expect(markup).toContain('conda activate unilab')
    expect(markup).toContain("pip install -e &#x27;.[observability]&#x27;")
    expect(markup).toContain('arize-phoenix==17.5.0')
    expect(markup).toContain('arize-phoenix-otel==0.16.1')
    expect(markup).toContain('停止并重新启动 Edge')
    expect(markup).toContain('每台机器都需要')
  })

  it('renders process output directly in the log drawer', () => {
    const logsSnapshot: LocalRuntimeLogsSnapshot = {
      readAt: 1_785_499_200_000,
      entries: [
        {
          kind: 'simulator',
          content: 'OPC UA ready on 127.0.0.1:18765',
          available: true,
          truncated: false
        },
        {
          kind: 'bridge',
          content: 'Edge service ready',
          available: true,
          truncated: false
        },
        {
          kind: 'edge',
          content: 'latest edge output',
          available: true,
          truncated: true
        }
      ]
    }

    const markup = renderToStaticMarkup(
      <LocalRuntimeLogDrawer
        snapshot={logsSnapshot}
        activeKind="edge"
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onOpenFile={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(markup).toContain('本地运行日志')
    expect(markup).toContain('PLC-Sim')
    expect(markup).toContain('Edge 运行时')
    expect(markup).toContain('latest edge output')
    expect(markup).toContain('界面保留最近 2,000 行')
    expect(markup).toContain('打开日志文件')
    expect(markup).toContain('轮转历史保留在同一目录')
    expect(markup).not.toContain('Edge 服务')
    expect(markup).not.toContain('>Bridge<')
  })

  it('strips terminal control codes and renders structured log rows', () => {
    const markup = renderToStaticMarkup(
      <LocalRuntimeLogDrawer
        snapshot={{
          readAt: 1_785_499_200_000,
          entries: [{
            kind: 'edge',
            content: [
              '\u001b[32m2026-08-03 16:04:05.123 | INFO | unilabos.app - Edge ready\u001b[0m',
              '\u001b]0;forged title\u0007',
              '\u001bPforged device control\u001b\\',
              '\u001bc\u001b7\u001b8\u001b=\u001b>single escape controls',
              '\u009dforged c1 title\u009c',
              '\u0090forged c1 device control\u009c',
              '\u009b31mc1 colored tail\u009b0m',
              '\u001b[37m26-08-03 [17:25:23,512]\u001b[0m \u001b[1;33m[WARNING]\u001b[0m \u001b[33mdevice retry\u001b[0m [run:42] [unilabos.runtime]',
              '[launcher] 2026-08-03T08:04:06.000Z starting',
              'plain diagnostic tail'
            ].join('\n'),
            available: true,
            truncated: false
          }]
        }}
        activeKind="edge"
        loading={false}
        error={null}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(markup).not.toContain('\u001b')
    expect(markup).not.toMatch(/[\u0080-\u009f]/)
    expect(markup).not.toContain('forged title')
    expect(markup).not.toContain('forged device control')
    expect(markup).not.toContain('forged c1 title')
    expect(markup).not.toContain('forged c1 device control')
    expect(markup).toContain('single escape controls')
    expect(markup).toContain('c1 colored tail')
    expect(markup).toContain('aria-label="格式化运行日志"')
    expect(markup).toContain('data-level="info"')
    expect(markup).toContain('16:04:05.123')
    expect(markup).toContain('Edge ready')
    expect(markup).toContain('data-level="warning"')
    expect(markup).toContain('17:25:23,512')
    expect(markup).toContain('unilabos.runtime')
    expect(markup).toContain('device retry')
    expect(markup).toContain('data-level="system"')
    expect(markup).toContain('plain diagnostic tail')
  })
})

function renderDialog(
  config: LocalRuntimeLaunchConfig,
  snapshot: LocalRuntimeSnapshot,
  phoenixDependencyMissing = false
): string {
  const transitioning = ![
    'idle',
    'simulator_ready',
    'ready',
    'failed'
  ].includes(snapshot.phase)
  return renderToStaticMarkup(
    <LocalRuntimeDialog
      config={config}
      snapshot={snapshot}
      error={null}
      simulatorSubmitted={false}
      edgeSubmitted={false}
      resolvingGeneratedEdgeCommand={false}
      simulatorValidation={validateSimulatorConfig(config)}
      edgeValidation={validateEdgeConfig(config)}
      phoenixDependencyMissing={phoenixDependencyMissing}
      transitioning={transitioning}
      onChange={vi.fn()}
      onChoosePath={vi.fn()}
      onClose={vi.fn()}
      onStartSimulator={vi.fn()}
      onStopSimulator={vi.fn()}
      onStartEdge={vi.fn()}
      onStopEdge={vi.fn()}
      onLoadGeneratedEdgeCommand={vi.fn()}
      logControl={<button type="button">查看日志</button>}
    />
  )
}
