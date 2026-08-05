import { once } from 'node:events'
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LocalRuntimeLaunchConfig } from '../shared/localRuntime'
import {
  readLocalRuntimeLog,
  readLocalRuntimeLogs,
  resolveLocalRuntimeLaunchPlan,
  resolveLocalSimulatorLaunchPlan,
  RotatingLogWriter
} from './localRuntimeManager'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, {
      recursive: true,
      force: true
    }))
  )
})

describe('LocalRuntimeManager command plan', () => {
  it('reads only the tail of fixed local runtime log files', async () => {
    const logsDirectory = await mkdtemp(join(tmpdir(), 'unilab-runtime-logs-'))
    temporaryDirectories.push(logsDirectory)
    await Promise.all([
      writeFile(join(logsDirectory, 'simulator.log'), 'old-prefix-latest'),
      writeFile(join(logsDirectory, 'edge.log'), '')
    ])

    const logs = await readLocalRuntimeLogs(logsDirectory, 6)

    expect(logs.entries).toEqual([
      {
        kind: 'simulator',
        content: 'latest',
        available: true,
        truncated: true
      },
      {
        kind: 'edge',
        content: '',
        available: true,
        truncated: false
      }
    ])
  })

  it('returns only bytes appended after the local runtime log cursor', async () => {
    const logsDirectory = await mkdtemp(join(tmpdir(), 'unilab-runtime-logs-'))
    temporaryDirectories.push(logsDirectory)
    await writeFile(join(logsDirectory, 'edge.log'), 'first\nsecond\n')

    const initial = await readLocalRuntimeLog(logsDirectory, {
      kind: 'edge',
      cursor: null
    })
    await appendFile(join(logsDirectory, 'edge.log'), 'third\n')
    const appended = await readLocalRuntimeLog(logsDirectory, {
      kind: 'edge',
      cursor: initial.cursor
    })

    expect(initial.reset).toBe(true)
    expect(initial.content).toBe('first\nsecond\n')
    expect(appended.reset).toBe(false)
    expect(appended.content).toBe('third\n')
    expect(appended.cursor?.offset).toBeGreaterThan(initial.cursor?.offset ?? 0)
  })

  it('rotates launcher diagnostics while the child process is still running', async () => {
    const logsDirectory = await mkdtemp(join(tmpdir(), 'unilab-runtime-logs-'))
    temporaryDirectories.push(logsDirectory)
    const logPath = join(logsDirectory, 'edge.log')
    const writer = new RotatingLogWriter(logPath, 12, 2)

    writer.write('12345678')
    writer.write('abcdefgh')
    writer.end('tail!')
    await once(writer, 'finish')

    expect(await readFile(logPath, 'utf8')).toBe('tail!')
    expect(await readFile(`${logPath}.1`, 'utf8')).toBe('abcdefgh')
    expect(await readFile(`${logPath}.2`, 'utf8')).toBe('12345678')
  })

  /** 证明公开 ROS CLI 启动计划携带合法的两位 ROS 域编号。 */
  it('launches the selected workspace through the public ROS unilab CLI', async () => {
    const fixture = await createFixture('packages')
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
      join(fixture.szlabRoot, 'runtime', 'ideawit-e2e'),
      '--backend',
      'ros',
      '--app_bridges',
      'fastapi',
      '--edge_scheduler',
      '--port',
      '18003',
      '--disable_browser',
      '--skip_env_check',
      '--test_mode'
    ])
    expect(plan.edge.env['ROS_DOMAIN_ID']).toMatch(/^(0[2-9]|[1-9]\d)$/)
    expect(plan.edge.env['UNILABOS_OBSERVABILITYCONFIG_ENABLED']).toBe('true')
    expect(plan.edge.env['UNILABOS_OBSERVABILITYCONFIG_PROJECT_NAME']).toBe(
      'uni-lab-electron'
    )
    expect(plan.edge.env['UNILABOS_HOSTLINKCONFIG_PORT']).toBe('18004')
    expect(plan.edge.env['PYTHONUNBUFFERED']).toBe('1')
    expect(plan.edge.env['PATH']?.split(delimiter)[0]).toBe(
      join(fixture.config.environmentPath, 'bin')
    )
    expect(plan.edge.env['PYTHONPATH']?.split(delimiter).slice(0, 2)).toEqual([
      fixture.osRoot,
      fixture.szlabRoot
    ])
    const runtimeDatabase = plan.edge.env['UNILABOS_RUNTIME_DB']
    expect(runtimeDatabase).toBeDefined()
    expect(dirname(runtimeDatabase ?? '')).toBe(
      join(fixture.szlabRoot, 'runtime', 'ideawit-e2e')
    )
    expect(basename(runtimeDatabase ?? '')).toMatch(
      /^edge-runtime-\d{8}-\d{6}\.sqlite3$/
    )
  })

  /** 证明每次 Edge 启动计划都重新取值，并覆盖 02 与 99 两个闭区间边界。 */
  it('assigns a new two-digit ROS domain id for each Edge launch plan', async () => {
    const fixture = await createFixture('packages')
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1 - Number.EPSILON)

    try {
      const lowerBoundaryPlan = await resolveLocalRuntimeLaunchPlan(
        fixture.config
      )
      const upperBoundaryPlan = await resolveLocalRuntimeLaunchPlan(
        fixture.config
      )

      expect(lowerBoundaryPlan.edge.env['ROS_DOMAIN_ID']).toBe('02')
      expect(upperBoundaryPlan.edge.env['ROS_DOMAIN_ID']).toBe('99')
    } finally {
      random.mockRestore()
    }
  })

  /** 证明自定义命令只替换 executable/argv，启动器托管的 cwd 与运行环境保持不变。 */
  it('resolves a structured custom Edge command inside the managed launch plan', async () => {
    const fixture = await createFixture('packages')
    const plan = await resolveLocalRuntimeLaunchPlan({
      ...fixture.config,
      edgeCommandMode: 'custom',
      customEdgeCommand: {
        executable: '{{python}}',
        args: [
          '-m',
          'unilabos.app.main',
          '--workspace',
          '{{workspace}}',
          '--graph={{graph}}',
          '--port',
          '{{edge_http_port}}',
          '--literal',
          'value with spaces & symbols'
        ]
      }
    })

    expect(plan.edge.command).toBe(fixture.python)
    expect(plan.edge.args).toEqual([
      '-m',
      'unilabos.app.main',
      '--workspace',
      fixture.szlabRoot,
      `--graph=${fixture.graphPath}`,
      '--port',
      '18003',
      '--literal',
      'value with spaces & symbols'
    ])
    expect(plan.edge.cwd).toBe(fixture.szlabRoot)
    expect(plan.edge.env['UNILABOS_HOSTLINKCONFIG_PORT']).toBe('18004')
    expect(plan.edge.env['ROS_DOMAIN_ID']).toMatch(/^(0[2-9]|[1-9]\d)$/)
  })

  it('supports the current root-level szlab_poly_studio layout', async () => {
    const fixture = await createFixture('root')
    const plan = await resolveLocalRuntimeLaunchPlan(fixture.config)

    expect(plan.edge.args).toContain('--workspace')
    expect(plan.edge.args).toContain(fixture.szlabRoot)
  })

  it('uses Windows Conda executables for PLC-Sim and Edge', async () => {
    const inheritedWindowsPath = 'C:\\Windows\\System32'
    vi.stubEnv('PATH', '')
    vi.stubEnv('Path', inheritedWindowsPath)
    const fixture = await createFixture('packages', 'win32')
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
    expect(fixture.config.environmentPath).toContain(
      'unilab windows runtime-'
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
      expect(Object.keys(spec.env).filter((key) => key.toLowerCase() === 'path'))
        .toEqual(['PATH'])
    }
  })

  it('resolves PLC-Sim without requiring Edge project paths', async () => {
    const fixture = await createFixture('packages')
    const plan = await resolveLocalSimulatorLaunchPlan({
      ...fixture.config,
      graphPath: '',
      osProjectPath: '',
      szlabProjectPath: ''
    })

    expect(plan.simulator.command).toBe(fixture.python)
    expect(plan.simulator.cwd).toBe(
      join(fixture.simulatorRoot, 'OpcUaSim')
    )
  })

  it('launches Edge without a domain device package workspace', async () => {
    const fixture = await createFixture('packages')
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
    expect(plan.edge.env['PYTHONPATH']?.split(delimiter)[0]).toBe(
      fixture.osRoot
    )
    expect(plan.edge.env['PYTHONPATH']).not.toContain(fixture.szlabRoot)
  })

  it('rejects a Conda environment without the expected executables', async () => {
    const fixture = await createFixture('packages')
    await rm(fixture.unilab)

    await expect(resolveLocalRuntimeLaunchPlan(fixture.config)).rejects.toThrow(
      '所选 Conda 环境缺少 bin/unilab'
    )
  })
})

/**
 * 构造同时包含 OS、领域设备包、Conda 可执行文件和 PLC-Sim 的启动计划测试目录。
 *
 * @param layout 领域设备包使用 packages 或当前根级目录布局。
 * @param platform 需要模拟的 Conda 可执行文件平台布局。
 * @returns 可直接提交给启动计划解析器的路径配置和对应权威测试路径。
 */
async function createFixture(
  layout: 'packages' | 'root',
  platform: NodeJS.Platform = 'linux'
): Promise<{
  config: LocalRuntimeLaunchConfig
  graphPath: string
  osRoot: string
  python: string
  simulatorRoot: string
  szlabRoot: string
  unilab: string
}> {
  const fixturePrefix = platform === 'win32'
    ? 'unilab windows runtime-'
    : 'unilab-runtime-manager-'
  const root = await mkdtemp(join(tmpdir(), fixturePrefix))
  temporaryDirectories.push(root)
  const osRoot = join(root, 'Uni-Lab-OS')
  const szlabRoot = join(root, 'Uni-Lab-SZLab')
  const environmentRoot = join(root, 'envs', 'unilab')
  const simulatorRoot = join(root, 'PLC-Sim')
  const graphPath = join(szlabRoot, 'deployment', 'graphs', 'device.json')
  const python = platform === 'win32'
    ? join(environmentRoot, 'python.exe')
    : join(environmentRoot, 'bin', 'python')
  const unilab = platform === 'win32'
    ? join(environmentRoot, 'Scripts', 'unilab.exe')
    : join(environmentRoot, 'bin', 'unilab')

  await Promise.all([
    mkdir(osRoot, { recursive: true }),
    mkdir(join(osRoot, 'unilabos', 'config'), { recursive: true }),
    mkdir(join(szlabRoot, 'deployment', 'graphs'), { recursive: true }),
    mkdir(dirname(python), { recursive: true }),
    mkdir(dirname(unilab), { recursive: true }),
    mkdir(join(simulatorRoot, 'OpcUaSim', 'gui'), { recursive: true })
  ])
  await Promise.all([
    writeFile(graphPath, '{}'),
    writeFile(join(osRoot, 'unilabos', 'config', 'example_config.py'), ''),
    writeFile(join(szlabRoot, 'deployment', 'local_config.py'), ''),
    writeFile(join(simulatorRoot, 'OpcUaSim', 'gui', 'backend.py'), ''),
    writeFile(python, ''),
    writeFile(unilab, '')
  ])
  await Promise.all([chmod(python, 0o755), chmod(unilab, 0o755)])

  if (layout === 'packages') {
    await mkdir(
      join(
        szlabRoot,
        'packages',
        'szlab_poly_studio',
        'szlab_poly_studio'
      ),
      { recursive: true }
    )
    await writeFile(
      join(szlabRoot, 'packages', 'szlab_poly_studio', 'package.yaml'),
      ''
    )
  } else {
    await mkdir(
      join(szlabRoot, 'szlab_poly_studio', 'profiles', 'default'),
      { recursive: true }
    )
    await writeFile(
      join(
        szlabRoot,
        'szlab_poly_studio',
        'profiles',
        'default',
        'package.yaml'
      ),
      ''
    )
  }

  return {
    config: {
      graphPath,
      osProjectPath: osRoot,
      szlabProjectPath: szlabRoot,
      environmentPath: environmentRoot,
      simulatorProjectPath: simulatorRoot,
      edgeCommandMode: 'generated',
      customEdgeCommand: {
        executable: '',
        args: []
      }
    },
    graphPath,
    osRoot,
    python,
    simulatorRoot,
    szlabRoot,
    unilab
  }
}
