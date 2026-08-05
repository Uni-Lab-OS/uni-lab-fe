import { describe, expect, it } from 'vitest'

import type { LocalRuntimeCustomEdgeCommand } from '../shared/localRuntime'
import {
  resolveLocalRuntimeEdgeCommand,
  type LocalRuntimeEdgeCommandTokens
} from './localRuntimeEdgeCommand'

const tokens: LocalRuntimeEdgeCommandTokens = {
  unilab: '/opt/Uni Lab/env/bin/unilab',
  python: '/opt/Uni Lab/env/bin/python',
  workspace: '/work/领域设备包 (SZLab)',
  graph: '/work/领域设备包 (SZLab)/deployment/graph.json',
  config: '/work/领域设备包 (SZLab)/deployment/local_config.py',
  working_dir: '/work/领域设备包 (SZLab)/runtime/edge',
  edge_http_port: '18003',
  hostlink_port: '18004'
}

describe('resolveLocalRuntimeEdgeCommand', () => {
  /** 证明占位符在单个 argv 项内展开，空格和 shell 元字符不会改变参数边界。 */
  it('preserves argument boundaries while expanding controlled tokens', () => {
    const template: LocalRuntimeCustomEdgeCommand = {
      executable: '{{python}}',
      args: [
        '-m',
        'unilabos.app.main',
        '--workspace={{workspace}}',
        'literal & | ; $ % !',
        '  ',
        '--port',
        '{{edge_http_port}}'
      ]
    }

    expect(resolveLocalRuntimeEdgeCommand(template, tokens, 'linux')).toEqual({
      command: tokens.python,
      args: [
        '-m',
        'unilabos.app.main',
        `--workspace=${tokens.workspace}`,
        'literal & | ; $ % !',
        '--port',
        '18003'
      ]
    })
  })

  /** 证明 Windows 原生 .exe 路径及含空格参数继续保持结构化传递。 */
  it('accepts a native Windows executable without shell quoting', () => {
    const windowsTokens: LocalRuntimeEdgeCommandTokens = {
      ...tokens,
      unilab: 'C:\\Program Files\\Uni Lab\\env\\Scripts\\unilab.exe'
    }

    expect(resolveLocalRuntimeEdgeCommand({
      executable: '{{unilab}}',
      args: ['--workspace', 'C:\\Lab Work\\SZLab', '--name="quoted"']
    }, windowsTokens, 'win32')).toEqual({
      command: windowsTokens.unilab,
      args: ['--workspace', 'C:\\Lab Work\\SZLab', '--name="quoted"']
    })
  })

  /** 证明 Windows 脚本不会隐式降级到 cmd.exe 或 PowerShell。 */
  it.each([
    'C:\\Edge\\launcher.cmd',
    'C:\\Edge\\launcher.bat',
    'C:\\Edge\\launcher.ps1',
    'C:\\Windows\\System32\\cmd.exe',
    'C:\\Program Files\\PowerShell\\pwsh.exe'
  ])(
    'rejects the Windows script executable %s',
    (executable) => {
      expect(() => resolveLocalRuntimeEdgeCommand({
        executable,
        args: []
      }, tokens, 'win32')).toThrow('Windows shell 或脚本')
    }
  )

  /** 证明未知模板和 NUL 字符在进入 child_process 前失败关闭。 */
  it('rejects unknown tokens and NUL characters', () => {
    expect(() => resolveLocalRuntimeEdgeCommand({
      executable: '{{unknown}}',
      args: []
    }, tokens, 'linux')).toThrow('未知占位符')
    expect(() => resolveLocalRuntimeEdgeCommand({
      executable: '{{python}}',
      args: ['bad\0argument']
    }, tokens, 'linux')).toThrow('NUL')
  })
})
