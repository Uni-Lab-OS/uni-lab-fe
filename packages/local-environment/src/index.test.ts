import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  resolvePlcSimulatorLaunch,
  runtimeExecutablePaths,
  validateRuntimeEnvironment
} from './index'

const fixtures: string[] = []

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(path => rm(path, {
    recursive: true,
    force: true
  })))
})

describe('PLC-Sim launch contract', () => {
  it('accepts a repository root and returns a shell-free Python launch plan', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-local-environment-'))
    fixtures.push(root)
    const environmentPath = join(root, 'env')
    const projectPath = join(root, 'PLC-Sim')
    await Promise.all([
      mkdir(join(environmentPath, 'bin'), { recursive: true }),
      mkdir(join(projectPath, 'OpcUaSim', 'gui'), { recursive: true })
    ])
    await Promise.all([
      writeFile(join(environmentPath, 'bin', 'python'), '#!/bin/sh\n'),
      writeFile(join(environmentPath, 'bin', 'unilab'), '#!/bin/sh\n'),
      writeFile(join(projectPath, 'OpcUaSim', 'gui', 'backend.py'), '')
    ])
    await Promise.all([
      chmod(join(environmentPath, 'bin', 'python'), 0o755),
      chmod(join(environmentPath, 'bin', 'unilab'), 0o755)
    ])

    await expect(resolvePlcSimulatorLaunch({
      environmentPath,
      projectPath,
      platform: 'linux',
      inheritedEnvironment: { PATH: '/usr/bin' }
    })).resolves.toMatchObject({
      command: runtimeExecutablePaths(environmentPath, 'linux').pythonExecutable,
      cwd: join(projectPath, 'OpcUaSim'),
      args: ['-m', 'gui.backend', '--host', '127.0.0.1', '--port', '18765'],
      guiUrl: 'http://127.0.0.1:18765',
      opcUaUrl: 'opc.tcp://127.0.0.1:4855'
    })
  })
})

describe('Runtime environment validation', () => {
  it('uses the native executable layout for Windows and macOS', () => {
    expect(runtimeExecutablePaths('C:\\envs\\unilab', 'win32')).toEqual({
      pythonExecutable: 'C:\\envs\\unilab\\python.exe',
      unilabExecutable: 'C:\\envs\\unilab\\Scripts\\unilab.exe'
    })
    expect(runtimeExecutablePaths('/tmp/envs/unilab', 'win32')).toEqual({
      pythonExecutable: '/tmp/envs/unilab/python.exe',
      unilabExecutable: '/tmp/envs/unilab/Scripts/unilab.exe'
    })
    expect(runtimeExecutablePaths('/opt/envs/unilab', 'darwin')).toEqual({
      pythonExecutable: '/opt/envs/unilab/bin/python',
      unilabExecutable: '/opt/envs/unilab/bin/unilab'
    })
  })

  it('checks the CLI plus UniLab OS and OPC UA imports', async () => {
    const root = await mkdtemp(join(tmpdir(), 'unilab-runtime-validation-'))
    fixtures.push(root)
    const environmentPath = join(root, 'env')
    const executables = runtimeExecutablePaths(environmentPath, process.platform)
    await Promise.all([
      mkdir(dirname(executables.pythonExecutable), { recursive: true }),
      mkdir(dirname(executables.unilabExecutable), { recursive: true })
    ])
    await Promise.all([
      writeFile(executables.pythonExecutable, ''),
      writeFile(executables.unilabExecutable, '')
    ])
    await Promise.all([
      chmod(executables.pythonExecutable, 0o755),
      chmod(executables.unilabExecutable, 0o755)
    ])
    const calls: Array<{ executable: string; args: string[] }> = []

    const resolvedEnvironment = await realpath(environmentPath)
    const resolvedExecutables = runtimeExecutablePaths(
      resolvedEnvironment,
      process.platform
    )
    await expect(validateRuntimeEnvironment(environmentPath, {
      platform: process.platform,
      inheritedEnvironment: { PATH: '' },
      runCommand: async (executable, args) => {
        calls.push({ executable, args })
      }
    })).resolves.toBe(resolvedEnvironment)

    expect(calls).toEqual(expect.arrayContaining([
      {
        executable: resolvedExecutables.unilabExecutable,
        args: ['-h']
      },
      {
        executable: resolvedExecutables.pythonExecutable,
        args: [
          '-c',
          [
            'from unilabos.app.main import main',
            'from opcua import Client, ua',
            'from fastapi import FastAPI',
            'from pydantic import BaseModel',
            'import uvicorn, yaml'
          ].join('; ')
        ]
      }
    ]))
  })
})
