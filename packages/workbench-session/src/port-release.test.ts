import { describe, expect, it, vi } from 'vitest'

import {
  releaseLoopbackPorts,
  type PortReleaseCommandRunner
} from './port-release'

describe('releaseLoopbackPorts', () => {
  it('terminates Windows listener process trees and verifies the ports', async () => {
    let queryCount = 0
    const commandRunner: PortReleaseCommandRunner = vi.fn(
      async command => {
        if (command === 'netstat.exe') {
          queryCount += 1
          return {
            stdout: queryCount === 1
              ? netstatListeners([
                  [18_003, 51],
                  [18_004, 52],
                  [18_003, 51],
                  [18_003, 999]
                ])
              : '',
            stderr: ''
          }
        }
        return { stdout: '', stderr: '' }
      }
    )
    const processKiller = vi.fn()

    await expect(releaseLoopbackPorts([18_003, 18_004, 18_003], {
      platform: 'win32',
      commandRunner,
      processKiller,
      currentProcessId: 999,
      verificationDelayMs: 0
    })).resolves.toEqual([51, 52])

    const calls = vi.mocked(commandRunner).mock.calls
    expect(calls[0]).toEqual(['netstat.exe', ['-ano', '-p', 'tcp']])
    expect(processKiller).toHaveBeenCalledWith(51, 'SIGKILL')
    expect(processKiller).toHaveBeenCalledWith(52, 'SIGKILL')
    expect(calls[1][0]).toBe('netstat.exe')
  })

  it('does nothing when no Windows process listens on the ports', async () => {
    const commandRunner: PortReleaseCommandRunner = vi.fn(async () => ({
      stdout: '',
      stderr: ''
    }))

    await expect(releaseLoopbackPorts([4_855], {
      platform: 'win32',
      commandRunner
    })).resolves.toEqual([])
    expect(commandRunner).toHaveBeenCalledTimes(1)
  })

  it('reports the remaining Windows listener after verification', async () => {
    const commandRunner: PortReleaseCommandRunner = vi.fn(
      async command => command === 'netstat.exe'
        ? { stdout: netstatListeners([[4_855, 51]]), stderr: '' }
        : { stdout: '', stderr: '' }
    )

    await expect(releaseLoopbackPorts([4_855], {
      platform: 'win32',
      commandRunner,
      processKiller: vi.fn(),
      verificationAttempts: 2,
      verificationDelayMs: 0
    })).rejects.toThrow('端口仍被进程 51 占用')
  })

  it('accepts a taskkill race when verification shows the port is free', async () => {
    let queryCount = 0
    const commandRunner: PortReleaseCommandRunner = vi.fn(async command => {
      if (command === 'taskkill.exe') throw new Error('process not found')
      queryCount += 1
      return {
        stdout: queryCount === 1 ? netstatListeners([[4_855, 51]]) : '',
        stderr: ''
      }
    })

    await expect(releaseLoopbackPorts([4_855], {
      platform: 'win32',
      commandRunner,
      processKiller: vi.fn(() => {
        throw new Error('native process not found')
      }),
      verificationDelayMs: 0
    })).resolves.toEqual([51])
  })

  it('falls back to taskkill when native Windows termination is denied', async () => {
    let queryCount = 0
    const commandRunner: PortReleaseCommandRunner = vi.fn(async command => {
      if (command === 'netstat.exe') {
        queryCount += 1
        return {
          stdout: queryCount === 1 ? netstatListeners([[4_855, 51]]) : '',
          stderr: ''
        }
      }
      return { stdout: '', stderr: '' }
    })

    await expect(releaseLoopbackPorts([4_855], {
      platform: 'win32',
      commandRunner,
      processKiller: vi.fn(() => {
        throw new Error('access denied')
      }),
      verificationDelayMs: 0
    })).resolves.toEqual([51])
    expect(commandRunner).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/PID', '51', '/T', '/F']
    )
  })

  it('releases and verifies macOS listeners while deduplicating processes', async () => {
    const queryCounts = new Map<string, number>()
    const commandRunner: PortReleaseCommandRunner = vi.fn(
      async (_command: string, args: string[]) => {
        const portArgument = args.find(argument => argument.startsWith('-iTCP:'))
          ?? ''
        const count = (queryCounts.get(portArgument) ?? 0) + 1
        queryCounts.set(portArgument, count)
        return {
          stdout: count === 1
            ? portArgument === '-iTCP:18765' ? '41\n42\n' : '41\n'
            : '',
          stderr: ''
        }
      }
    )
    const processKiller = vi.fn<(pid: number, signal: NodeJS.Signals) => void>()

    await expect(releaseLoopbackPorts([18_765, 4_855], {
      platform: 'darwin',
      commandRunner,
      processKiller,
      currentProcessId: 999,
      verificationDelayMs: 0
    })).resolves.toEqual([41, 42])
    expect(processKiller).toHaveBeenCalledTimes(2)
    expect(processKiller).toHaveBeenCalledWith(41, 'SIGKILL')
    expect(processKiller).toHaveBeenCalledWith(42, 'SIGKILL')
    expect(commandRunner).toHaveBeenCalledWith(
      'lsof',
      ['-nP', '-iTCP:18765', '-sTCP:LISTEN', '-t']
    )
  })

  it('reports a macOS listener that remains after termination', async () => {
    const commandRunner: PortReleaseCommandRunner = vi.fn(async () => ({
      stdout: '41\n',
      stderr: ''
    }))

    await expect(releaseLoopbackPorts([4_855], {
      platform: 'darwin',
      commandRunner,
      processKiller: vi.fn(),
      verificationAttempts: 2,
      verificationDelayMs: 0
    })).rejects.toThrow('macOS 释放端口 4855 失败：端口仍被进程 41 占用')
  })

  it('accepts a macOS kill race when verification shows the port is free', async () => {
    let queryCount = 0
    const commandRunner: PortReleaseCommandRunner = vi.fn(async () => {
      queryCount += 1
      return {
        stdout: queryCount === 1 ? '41\n' : '',
        stderr: ''
      }
    })

    await expect(releaseLoopbackPorts([4_855], {
      platform: 'darwin',
      commandRunner,
      processKiller: vi.fn(() => {
        throw new Error('process already exited')
      }),
      verificationDelayMs: 0
    })).resolves.toEqual([41])
  })

  it('reports a Windows query failure with the selected ports', async () => {
    const commandRunner: PortReleaseCommandRunner = vi.fn(async () => {
      throw new Error('access denied')
    })
    await expect(releaseLoopbackPorts([4_855], {
      platform: 'win32',
      commandRunner
    })).rejects.toThrow('Windows 释放端口 4855 失败：access denied')
  })
})

function netstatListeners(entries: Array<[port: number, pid: number]>): string {
  return entries.map(([port, pid], index) => index % 2 === 0
    ? `  TCP    0.0.0.0:${port}    0.0.0.0:0    LISTENING    ${pid}`
    : `  TCP    [::]:${port}       [::]:0       LISTENING    ${pid}`
  ).join('\r\n')
}
