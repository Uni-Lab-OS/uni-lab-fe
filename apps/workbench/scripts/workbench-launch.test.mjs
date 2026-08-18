import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'

import {
  createWorkbenchRendererUrl,
  discoverWorkbenchOsProject,
  discoverWorkbenchPythonEnvironment,
  isolateWorkbenchBackendProcessGroup,
  resolveWorkbenchLaunchConfiguration,
  resolveWorkbenchLaunchMode,
  workbenchEnvironmentPathEntries
} from './workbench-launch.mjs'

it('isolates the Theia backend process group on POSIX', () => {
  assert.equal(isolateWorkbenchBackendProcessGroup('darwin'), true)
  assert.equal(isolateWorkbenchBackendProcessGroup('linux'), true)
  assert.equal(isolateWorkbenchBackendProcessGroup('win32'), false)
})

describe('Workbench launch contract', () => {
  it('keeps browser mode as the default and accepts desktop explicitly', () => {
    assert.equal(resolveWorkbenchLaunchMode([]), 'browser')
    assert.equal(resolveWorkbenchLaunchMode(['--desktop']), 'desktop')
    assert.equal(resolveWorkbenchLaunchMode(['--remote']), 'remote')
    assert.equal(
      resolveWorkbenchLaunchMode(['--desktop', '--remote']),
      'desktop-remote'
    )
    assert.throws(
      () => resolveWorkbenchLaunchMode(['--destkop']),
      /Unknown Workbench argument/
    )
  })

  it('accepts explicit workspace, OS, environment and port selections', () => {
    assert.deepEqual(resolveWorkbenchLaunchConfiguration([
      '--desktop',
      '--workspace', '/tmp/workspace',
      '--os-project', '/tmp/os',
      '--python-env', '/tmp/env',
      '--port', '3110',
      '--workflow', 'workflow-1'
    ], {}, '/tmp'), {
      mode: 'desktop',
      workspace: '/tmp/workspace',
      osProject: '/tmp/os',
      pythonEnvironment: '/tmp/env',
      port: 3110,
      workflowUuid: 'workflow-1',
      remote: null
    })
    assert.throws(
      () => resolveWorkbenchLaunchConfiguration(['--workspace']),
      /requires a value/
    )
  })

  it('parses a fail-closed remote facade selection', () => {
    assert.deepEqual(resolveWorkbenchLaunchConfiguration([
      '--remote',
      '--',
      '--workspace', '/tmp/workspace',
      '--port', '3110',
      '--remote-host', '0.0.0.0',
      '--remote-port', '8443',
      '--public-origin', 'https://workbench.example.test',
      '--tls-cert', './tls/cert.pem',
      '--tls-key', './tls/key.pem',
      '--remote-auth-mode', 'disabled',
      '--token-ttl-seconds', '3600',
      '--access-url-file', '../run/workbench.url'
    ], {}, '/srv/unilab'), {
      mode: 'remote',
      workspace: '/tmp/workspace',
      osProject: null,
      pythonEnvironment: null,
      port: 3110,
      workflowUuid: null,
      remote: {
        host: '0.0.0.0',
        port: 8443,
        publicOrigin: 'https://workbench.example.test',
        tlsCertificatePath: '/srv/unilab/tls/cert.pem',
        tlsKeyPath: '/srv/unilab/tls/key.pem',
        authenticationRequired: false,
        tokenTtlMs: 3_600_000,
        accessUrlFile: '/srv/run/workbench.url'
      }
    })
    assert.equal(resolveWorkbenchLaunchConfiguration([
      '--desktop', '--remote'
    ], {}, '/tmp').mode, 'desktop-remote')
    assert.throws(
      () => resolveWorkbenchLaunchConfiguration(['--remote-port', '8443']),
      /require --remote/
    )
    assert.throws(
      () => resolveWorkbenchLaunchConfiguration([
        '--remote', '--port', '3110', '--remote-port', '3110'
      ]),
      /must differ/
    )
    assert.throws(
      () => resolveWorkbenchLaunchConfiguration([
        '--remote', '--remote-auth-mode', 'optional'
      ]),
      /must be required or disabled/
    )
  })

  it('discovers the same executable environment before Theia starts', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-launch-env-'))
    const environmentRoot = path.join(root, 'env')
    await mkdir(path.join(environmentRoot, 'bin'), { recursive: true })
    try {
      for (const executable of ['python', 'unilab']) {
        const target = path.join(environmentRoot, 'bin', executable)
        await writeFile(target, '#!/bin/sh\nexit 0\n')
        await chmod(target, 0o755)
      }
      assert.equal(await discoverWorkbenchPythonEnvironment({
        environment: { PATH: path.join(environmentRoot, 'bin') },
        homeDirectory: root,
        platform: 'darwin'
      }), await realpath(environmentRoot))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('prefers the managed unilab environment over an active Conda base', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-managed-env-'))
    const base = path.join(root, 'miniforge3')
    const managed = path.join(base, 'envs', 'unilab')
    try {
      await Promise.all([base, managed].map(createExecutableEnvironment))

      assert.equal(await discoverWorkbenchPythonEnvironment({
        environment: {
          CONDA_DEFAULT_ENV: 'base',
          CONDA_PREFIX: base,
          PATH: path.join(base, 'bin')
        },
        homeDirectory: root,
        platform: 'darwin'
      }), await realpath(managed))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('discovers the Uni-Lab-OS checkout resolved by an editable environment', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-os-project-'))
    const workspace = path.join(root, 'Uni-Lab-SZLab')
    const siblingDecoy = path.join(root, 'Uni-Lab-OS')
    const osProject = path.join(root, 'sources', 'Uni-Lab-OS')
    const pythonEnvironment = path.join(root, 'env')
    try {
      await Promise.all([
        mkdir(workspace, { recursive: true }),
        mkdir(path.join(siblingDecoy, 'unilabos'), { recursive: true }),
        mkdir(path.join(osProject, 'unilabos'), { recursive: true }),
        mkdir(path.join(pythonEnvironment, 'bin'), { recursive: true })
      ])
      await writeFile(path.join(siblingDecoy, 'setup.py'), 'from setuptools import setup\n')
      await writeFile(path.join(osProject, 'setup.py'), 'from setuptools import setup\n')
      const python = path.join(pythonEnvironment, 'bin', 'python')
      await writeFile(python, `#!/bin/sh\nprintf '%s\\n' '${osProject}'\n`)
      await chmod(python, 0o755)

      assert.equal(await discoverWorkbenchOsProject({
        selected: null,
        pythonEnvironment,
        platform: 'darwin'
      }), await realpath(osProject))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects an invalid explicitly selected Uni-Lab-OS checkout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-invalid-os-'))
    try {
      await assert.rejects(
        discoverWorkbenchOsProject({
          selected: root,
          pythonEnvironment: null
        }),
        /missing project metadata or unilabos/
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not turn an ordinary site-packages install into a source checkout', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'unilab-wheel-os-'))
    const pythonEnvironment = path.join(root, 'env')
    const sitePackages = path.join(root, 'lib', 'python', 'site-packages')
    try {
      await Promise.all([
        mkdir(path.join(pythonEnvironment, 'bin'), { recursive: true }),
        mkdir(path.join(sitePackages, 'unilabos'), { recursive: true })
      ])
      await writeFile(path.join(sitePackages, 'setup.py'), '# decoy metadata\n')
      const python = path.join(pythonEnvironment, 'bin', 'python')
      await writeFile(python, `#!/bin/sh\nprintf '%s\\n' '${sitePackages}'\n`)
      await chmod(python, 0o755)

      assert.equal(await discoverWorkbenchOsProject({
        selected: null,
        pythonEnvironment,
        platform: 'darwin'
      }), null)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('projects workspace and workflow identity into the loopback URL', () => {
    assert.equal(createWorkbenchRendererUrl({
      port: 3110,
      workspace: '/tmp/Uni Lab/SZLab',
      workflowUuid: 'workflow-1'
    }), 'http://127.0.0.1:3110/?workflowUuid=workflow-1#/tmp/Uni%20Lab/SZLab')
  })

  it('activates the complete executable path on POSIX and Windows', () => {
    assert.deepEqual(
      workbenchEnvironmentPathEntries('/opt/conda/envs/unilab', 'linux'),
      ['/opt/conda/envs/unilab/bin']
    )
    assert.deepEqual(
      workbenchEnvironmentPathEntries('C:\\UniLab\\env', 'win32'),
      [
        'C:\\UniLab\\env',
        'C:\\UniLab\\env\\Scripts',
        'C:\\UniLab\\env\\Library\\mingw-w64\\bin',
        'C:\\UniLab\\env\\Library\\usr\\bin',
        'C:\\UniLab\\env\\Library\\bin',
        'C:\\UniLab\\env\\bin'
      ]
    )
  })
})

async function createExecutableEnvironment(environmentRoot) {
  await mkdir(path.join(environmentRoot, 'bin'), { recursive: true })
  for (const executable of ['python', 'unilab']) {
    const target = path.join(environmentRoot, 'bin', executable)
    await writeFile(target, '#!/bin/sh\nexit 0\n')
    await chmod(target, 0o755)
  }
}
