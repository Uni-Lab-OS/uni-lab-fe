import { describe, expect, it } from 'vitest'

import {
  createWorkbenchStartupFailureMonitor,
  diagnoseFatalWorkbenchStartupOutput
} from './startup-diagnostics'

const PLC_TRACEBACK = [
  '\u001b[31m[ERROR]\u001b[0m client connect failed: [Errno 8] nodename nor servname provided',
  'Exception in thread backend_thread:',
  'Traceback (most recent call last):',
  '  File "/os/unilabos/ros/nodes/presets/host_node.py", line 945, in initialize_device',
  '  File "/workspace/szlab_poly_plc/device.py", line 501, in _connect',
  '  File "/python/site-packages/opcua/client/client.py", line 307, in connect_socket',
  '    sock = socket.create_connection((host, port), timeout=self.timeout)',
  'socket.gaierror: [Errno 8] nodename nor servname provided, or not known',
  ''
].join('\n')

describe('Workbench startup diagnostics', () => {
  it('classifies a terminal PLC hostname failure with actionable recovery', () => {
    const failure = diagnoseFatalWorkbenchStartupOutput(PLC_TRACEBACK)

    expect(failure?.diagnostic).toEqual({
      code: 'plc_connection_failed',
      message: '无法解析 PLC 的 OPC UA 主机名，OS 设备目录未完成初始化。',
      recovery: expect.stringContaining('127.0.0.1')
    })
  })

  it('waits for a complete fatal traceback across output chunks', () => {
    const monitor = createWorkbenchStartupFailureMonitor()
    const terminalException = 'socket.gaierror: [Errno 8] nodename nor servname provided, or not known\n'
    const splitAt = PLC_TRACEBACK.indexOf(terminalException)

    monitor.observe(Buffer.from(PLC_TRACEBACK.slice(0, splitAt)))
    expect(monitor.failure()).toBeNull()

    monitor.observe(terminalException)
    expect(monitor.failure()?.diagnostic.code).toBe('plc_connection_failed')
  })

  it.each([
    [
      'ConnectionRefusedError: [Errno 61] Connection refused',
      '连接被拒绝'
    ],
    [
      'TimeoutError: connection timed out',
      '超时'
    ]
  ])('classifies terminal PLC connection errors: %s', (terminalError, message) => {
    const output = PLC_TRACEBACK.replace(
      /socket\.gaierror:.*\n$/,
      `${terminalError}\n`
    )

    expect(diagnoseFatalWorkbenchStartupOutput(output)?.diagnostic).toMatchObject({
      code: 'plc_connection_failed',
      message: expect.stringContaining(message)
    })
  })

  it.each([
    [
      'a temporary HostNode response',
      'HTTP 200 {"code":2001,"message":"Host node not initialized"}'
    ],
    [
      'a recoverable connection log without a terminated backend thread',
      '[ERROR] client connect failed: connection refused; retrying'
    ],
    [
      'an unrelated backend exception',
      [
        'Exception in thread backend_thread:',
        '  File "/os/unilabos/ros/nodes/presets/host_node.py", line 945, in initialize_device',
        'RuntimeError: registry entry is invalid'
      ].join('\n')
    ],
    [
      'an OPC UA traceback outside HostNode initialization',
      [
        'Exception in thread telemetry_thread:',
        '  File "/python/site-packages/opcua/client/client.py", line 307, in connect_socket',
        'ConnectionRefusedError: [Errno 61] Connection refused'
      ].join('\n')
    ]
  ])('does not misclassify %s', (_case, output) => {
    expect(diagnoseFatalWorkbenchStartupOutput(output)).toBeNull()
  })
})
