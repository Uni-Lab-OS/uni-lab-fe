import { rm } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resolveLocalRuntimeLaunchPlan,
  resolveLocalSimulatorLaunchPlan
} from './localRuntimeManager'
import {
  cleanupLocalRuntimeTestArtifacts,
  createLocalRuntimeTestFixture
} from './localRuntimeManager.testSupport'

/** 清理测试路径并恢复环境变量替身。 */
afterEach(async () => {
  vi.unstubAllEnvs()
  await cleanupLocalRuntimeTestArtifacts()
})

/** 覆盖本地运行启动计划的路径、命令、端口和环境合同。 */
describe('Local runtime launch plan', () => {
  /** 证明公开 ROS CLI 启动计划不注入测试模式或独立 SQLite 路径。 */
  it('launches the selected workspace through the public ROS unilab CLI', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const plan = await resolveLocalRuntimeLaunchPlan(fixture.config)
    const simulatorPlan = await resolveLocalSimulatorLaunchPlan(fixture.config)

    expect(simulatorPlan.simulator).toMatchObject({
      command: fixture.python,
      cwd: join(fixture.simulatorRoot, 'OpcUaSim'),
      args: [
        '-m',
        'gui.backend',
        '--host',
        '127.0.0.1',
        '--port',
        '18765'
      ]
    })
    expect(plan).not.toHaveProperty('bridge')
    expect(plan.deviceCatalogRequirement).toBe('domain_actions')
    expect(plan.edge.command).toBe(fixture.unilab)
    expect(plan.edge.cwd).toBe(fixture.szlabRoot)
    expect(plan.edge.args).toEqual([
      '--workspace',
      fixture.szlabRoot,
      '--graph',
      fixture.graphPath,
      '--config',
      join(fixture.szlabRoot, 'deployment', 'local_config.py'),
      '--working_dir',
      join(fixture.szlabRoot, 'runtime', 'plc-sim-e2e', 'os'),
      '--backend',
      'ros',
      '--app_bridges',
      'fastapi',
      '--port',
      '18003',
      '--disable_browser',
      '--skip_env_check'
    ])
    expect(plan.edge.args).not.toContain('--test_mode')
    expect(plan.edge.env['ROS_DOMAIN_ID']).toMatch(/^(?:[2-9]|[1-9]\d)$/)
    expect(plan.edge.env['UNILABOS_OBSERVABILITYCONFIG_ENABLED']).toBe('true')
    expect(plan.edge.env['UNILABOS_OBSERVABILITYCONFIG_PROJECT_NAME']).toBe(
      'uni-lab-electron'
    )
    expect(plan.edge.env['UNILABOS_OTEL_ENABLED']).toBe('true')
    expect(plan.edge.env['OTEL_EXPORTER_OTLP_ENDPOINT']).toBe(
      'http://127.0.0.1:4318'
    )
    expect(plan.edge.env['OTEL_EXPORTER_OTLP_PROTOCOL']).toBe('http/protobuf')
    expect(plan.edge.env['OTEL_EXPORTER_OTLP_INSECURE']).toBe('true')
    expect(plan.edge.env['OTEL_SERVICE_NAME']).toBe('uni-lab-edge-local')
    expect(plan.edge.env['OTEL_DEPLOYMENT_ENVIRONMENT']).toBe('development')
    expect(plan.edge.env['UNILABOS_HOSTLINKCONFIG_PORT']).toBe('18004')
    expect(plan.edge.env['PYTHONUNBUFFERED']).toBe('1')
    expect(plan.edge.env['PATH']?.split(delimiter)[0]).toBe(
      join(fixture.config.environmentPath, 'bin')
    )
    expect(plan.edge.env['PYTHONPATH']?.split(delimiter).slice(0, 2)).toEqual([
      fixture.osRoot,
      fixture.szlabRoot
    ])
    expect(plan.edge.env).not.toHaveProperty('UNILABOS_RUNTIME_DB')
  })

  /** 证明 PLC-Sim 与边缘执行（Edge）声明各自需要提前释放的端口。 */
  it('declares the listening ports released before each launch path', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const simulatorPlan = await resolveLocalSimulatorLaunchPlan(fixture.config)
    const edgePlan = await resolveLocalRuntimeLaunchPlan(fixture.config)

    expect(simulatorPlan.requiredPorts).toEqual([
      { port: 18_765, label: 'PLC-Sim Web GUI' },
      { port: 4_855, label: 'PLC-Sim OPC UA' }
    ])
    expect(edgePlan.requiredPorts).toEqual([
      { port: 18_003, label: '领域侧 Edge HTTP' },
      { port: 18_004, label: 'Edge HostLink' }
    ])
  })

  /** 证明每次 Edge 计划重新取值，且 ROS 域编号不带前导零。 */
  it('assigns a decimal ROS domain id for each Edge launch plan', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1 - Number.EPSILON)

    try {
      const lowerPlan = await resolveLocalRuntimeLaunchPlan(fixture.config)
      const upperPlan = await resolveLocalRuntimeLaunchPlan(fixture.config)
      expect(lowerPlan.edge.env['ROS_DOMAIN_ID']).toBe('2')
      expect(upperPlan.edge.env['ROS_DOMAIN_ID']).toBe('99')
    } finally {
      random.mockRestore()
    }
  })

  /** 证明自定义命令只替换可执行文件与参数，托管环境仍由启动器补齐。 */
  it('resolves a structured custom Edge command inside the managed launch plan', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const plan = await resolveLocalRuntimeLaunchPlan({
      ...fixture.config,
      edgeCommandMode: 'custom',
      customEdgeCommand: {
        executable: '{{python}}',
        workingDirectory: '{{workspace}}',
        args: [
          '-m',
          'unilabos.app.main',
          '--workspace',
          '{{workspace}}',
          '--graph={{graph}}',
          '--working_dir',
          '{{working_dir}}',
          '--port',
          '{{edge_http_port}}',
          '--literal',
          'value with spaces & symbols'
        ],
        environment: [{ name: 'DEVICE_MODE', value: 'simulation' }]
      }
    })

    expect(plan.edge.command).toBe(fixture.python)
    expect(plan.edge.args).toEqual([
      '-m',
      'unilabos.app.main',
      '--workspace',
      fixture.szlabRoot,
      `--graph=${fixture.graphPath}`,
      '--working_dir',
      join(fixture.szlabRoot, 'runtime', 'plc-sim-e2e', 'os'),
      '--port',
      '18003',
      '--literal',
      'value with spaces & symbols'
    ])
    expect(plan.edge.cwd).toBe(fixture.szlabRoot)
    expect(plan.edge.env['DEVICE_MODE']).toBe('simulation')
    expect(plan.edge.env['UNILABOS_HOSTLINKCONFIG_PORT']).toBe('18004')
    expect(plan.edge.env['ROS_DOMAIN_ID']).toMatch(/^(?:[2-9]|[1-9]\d)$/)
  })

  /** 验证当前根级领域设备包布局仍能生成工作区参数。 */
  it('supports the current root-level szlab_poly_studio layout', async () => {
    const fixture = await createLocalRuntimeTestFixture('root')
    const plan = await resolveLocalRuntimeLaunchPlan(fixture.config)
    expect(plan.edge.args).toContain('--workspace')
    expect(plan.edge.args).toContain(fixture.szlabRoot)
  })

  /** 验证 Windows 使用对应 Conda 可执行文件与唯一大写 PATH。 */
  it.runIf(process.platform === 'win32')(
    'uses Windows Conda executables for PLC-Sim and Edge',
    async () => {
      const inheritedWindowsPath = 'C:\\Windows\\System32'
      vi.stubEnv('PATH', '')
      vi.stubEnv('Path', inheritedWindowsPath)
      const fixture = await createLocalRuntimeTestFixture('packages', 'win32')
      const plan = await resolveLocalRuntimeLaunchPlan(fixture.config, 'win32')
      const simulatorPlan = await resolveLocalSimulatorLaunchPlan(
        fixture.config,
        'win32'
      )

      expect(fixture.python).toBe(
        join(fixture.config.environmentPath, 'python.exe')
      )
      expect(fixture.unilab).toBe(
        join(fixture.config.environmentPath, 'Scripts', 'unilab.exe')
      )
      expect(simulatorPlan.simulator.command).toBe(fixture.python)
      expect(plan.edge.command).toBe(fixture.unilab)
      expect(plan.edge.env['PYTHONPATH']?.split(';').slice(0, 2)).toEqual([
        fixture.osRoot,
        fixture.szlabRoot
      ])
      const activatedPath = [
        fixture.config.environmentPath,
        join(fixture.config.environmentPath, 'Library', 'mingw-w64', 'bin'),
        join(fixture.config.environmentPath, 'Library', 'usr', 'bin'),
        join(fixture.config.environmentPath, 'Library', 'bin'),
        join(fixture.config.environmentPath, 'Scripts'),
        join(fixture.config.environmentPath, 'bin')
      ]
      for (const spec of [simulatorPlan.simulator, plan.edge]) {
        expect(spec.env['CONDA_PREFIX']).toBe(fixture.config.environmentPath)
        expect(spec.env['CONDA_DEFAULT_ENV']).toBe(
          basename(fixture.config.environmentPath)
        )
        expect(spec.env['CONDA_SHLVL']).toBe('1')
        expect(spec.env['PATH']?.split(';').slice(0, activatedPath.length))
          .toEqual(activatedPath)
        expect(spec.env['PATH']?.split(';').at(-1)).toBe(inheritedWindowsPath)
        expect(Object.keys(spec.env).filter(
          (key) => key.toLowerCase() === 'path'
        )).toEqual(['PATH'])
      }
    }
  )

  /** 验证 PLC-Sim 计划不依赖边缘执行（Edge）项目路径。 */
  it('resolves PLC-Sim without requiring Edge project paths', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const plan = await resolveLocalSimulatorLaunchPlan({
      ...fixture.config,
      graphPath: '',
      osProjectPath: '',
      szlabProjectPath: ''
    })
    expect(plan.simulator.command).toBe(fixture.python)
    expect(plan.simulator.cwd).toBe(join(fixture.simulatorRoot, 'OpcUaSim'))
  })

  /** 验证无领域设备包时使用 OS 内置配置并允许空设备目录就绪。 */
  it('launches Edge without a domain device package workspace', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    const plan = await resolveLocalRuntimeLaunchPlan({
      ...fixture.config,
      szlabProjectPath: ''
    })

    expect(plan.edge.cwd).toBe(fixture.osRoot)
    expect(plan.deviceCatalogRequirement).toBe('catalog')
    expect(plan.edge.args).not.toContain('--workspace')
    expect(plan.edge.args).toContain('--config')
    expect(plan.edge.args).toContain(
      join(fixture.osRoot, 'unilabos', 'config', 'example_config.py')
    )
    expect(plan.edge.args).toEqual(expect.arrayContaining([
      '--graph',
      fixture.graphPath,
      '--backend',
      'ros',
      '--app_bridges',
      'fastapi'
    ]))
    expect(plan.edge.env['PYTHONPATH']?.split(delimiter)[0]).toBe(fixture.osRoot)
    expect(plan.edge.env['PYTHONPATH']).not.toContain(fixture.szlabRoot)
  })

  /** 验证明示损坏的 Conda 环境仍关闭失败，不被空设备模式掩盖。 */
  it('rejects a Conda environment without the expected executables', async () => {
    const fixture = await createLocalRuntimeTestFixture('packages')
    await rm(fixture.unilab)
    await expect(resolveLocalRuntimeLaunchPlan(fixture.config)).rejects.toThrow(
      '所选 Conda 环境缺少 bin/unilab'
    )
  })
})
