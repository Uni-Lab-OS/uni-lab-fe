import { describe, expect, it } from 'vitest'

import {
  formatLocalRuntimeLog,
  prepareLocalRuntimeLogCopyText
} from './localRuntimeLogFormatting'

describe('localRuntimeLogFormatting', () => {
  /**
   * 验证常见本地诊断格式统一拆分时间、级别、来源和正文。
   *
   * @returns 无返回值；通过结构化记录断言格式化合同。
   * @throws 任一常见格式字段归属错误时由断言报告失败。
   * @safety 只处理内存日志样本，不访问真实日志文件。
   */
  it('统一解析 info、warning 和 error 的常见格式', () => {
    const rows = formatLocalRuntimeLog([
      '2026-08-05 12:01:30.000 | INFO | worker - worker ready',
      '26-08-05 [12:01:31,125] [WARNING] uvicorn.protocols.http.httptools_impl [Uvicorn.HTTP] request delayed',
      '[ERROR] [1754380892.250] [plc_sim]: emergency stop'
    ].join('\n'))

    expect(rows).toEqual([
      {
        time: '12:01:30.000',
        level: 'info',
        source: 'worker',
        message: 'worker ready'
      },
      {
        time: '12:01:31,125',
        level: 'warning',
        source: 'uvicorn.protocols.http.httptools_impl',
        message: '[Uvicorn.HTTP] request delayed'
      },
      {
        time: '1754380892.250',
        level: 'error',
        source: 'plc_sim',
        message: 'emergency stop'
      }
    ])
  })

  /**
   * 验证未知格式逐行保底，内部空行、缩进和长正文均不会丢失。
   *
   * @returns 无返回值；通过普通日志消息序列断言原文保真。
   * @throws 任一输入行被丢弃、裁剪或改写时由断言报告失败。
   * @safety 仅比较内存字符串，不解释或执行日志内容。
   */
  it('完整保留未知格式、空白行、缩进和长正文', () => {
    const longLine = `unknown-${'A1B2C3D4'.repeat(80)}-tail`
    const rows = formatLocalRuntimeLog([
      'unknown first',
      '',
      '    indented context',
      longLine,
      ''
    ].join('\n'))

    expect(rows.map((row) => row.message)).toEqual([
      'unknown first',
      '',
      '    indented context',
      longLine
    ])
    expect(rows.every((row) => row.level === 'plain')).toBe(true)
  })

  /**
   * 验证 Python traceback 作为一条错误记录呈现并保留原始堆栈缩进。
   *
   * @returns 无返回值；通过错误正文及后续普通行断言分组边界。
   * @throws traceback 被拆散、缩进丢失或吞并后续行时由断言报告失败。
   * @safety 只识别固定 traceback 边界，不执行 Python 文本。
   */
  it('合并 traceback 且保留堆栈缩进和后续原文', () => {
    const rows = formatLocalRuntimeLog([
      '2026-08-05 12:01:31.000 | ERROR | worker - Action failed',
      'Traceback (most recent call last):',
      '  File "worker.py", line 18, in run',
      '    raise ValueError("invalid volume")',
      'ValueError: invalid volume',
      'unrecognized tail'
    ].join('\n'))

    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ level: 'error', source: 'worker' })
    expect(rows[0]?.message).toBe([
      'Action failed',
      'Traceback (most recent call last):',
      '  File "worker.py", line 18, in run',
      '    raise ValueError("invalid volume")',
      'ValueError: invalid volume'
    ].join('\n'))
    expect(rows[1]?.message).toBe('unrecognized tail')
  })

  /**
   * 验证复制文本只剥离终端控制码，同时保留换行、空行和缩进。
   *
   * @returns 无返回值；通过精确字符串断言剪贴板内容合同。
   * @throws 控制码残留或诊断文本发生变化时由断言报告失败。
   * @safety 不写入系统剪贴板，只验证写入前的安全文本转换。
   */
  it('生成保留换行与缩进的安全复制文本', () => {
    const content = [
      '\u001b[31mERROR\u001b[0m Action failed',
      '',
      '  File "worker.py", line 18',
      'ValueError: invalid volume'
    ].join('\n')

    expect(prepareLocalRuntimeLogCopyText(content)).toBe([
      'ERROR Action failed',
      '',
      '  File "worker.py", line 18',
      'ValueError: invalid volume'
    ].join('\n'))
  })

  it('格式化可关联 Task、Job、派发效果与 PLC 变量的前置诊断', () => {
    const payload = {
      phase: 'waiting_precondition',
      diagnostic_event: 'waiting',
      observed_at: '2026-08-06T04:00:05Z',
      task_uuid: 'task-s04',
      job_uuid: 'job-s04',
      effect: { identity: 'job-s04:2', phase: 'waiting_precondition' },
      sensor: '传感器状态_上位机[2].NO[10]',
      position: 1,
      expected_value: true,
      actual_value: false,
      elapsed_s: 5,
      timeout_s: 300,
      remaining_s: 295
    }
    const rows = formatLocalRuntimeLog(
      `26-08-06 [12:00:05,000] [INFO] unilabos [UNILAB-ACTION-FEEDBACK] ${
        JSON.stringify(payload)
      } [publish_action_feedback:1] [unilabos.ros.action_feedback]`
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      time: '04:00:05Z',
      level: 'info',
      source: 'PLC 前置诊断'
    })
    expect(rows[0]?.message).toContain('waiting · 正在等待前置传感器')
    expect(rows[0]?.message).toContain('工作流任务（WorkflowTask） task-s04')
    expect(rows[0]?.message).toContain('作业（Job） job-s04')
    expect(rows[0]?.message).toContain('派发效果（DispatchEffect） job-s04:2')
    expect(rows[0]?.message).toContain('变量 传感器状态_上位机[2].NO[10]')
    expect(rows[0]?.message).toContain('位置 1')
    expect(rows[0]?.message).toContain('期望 true')
    expect(rows[0]?.message).toContain('实际 false')
    expect(rows[0]?.message).toContain('已等待 5 秒/300 秒')
  })

  it.each([
    ['precondition_check_started', '请求已到达 PLC 网关', 'info'],
    ['satisfied', '前置传感器已满足', 'info'],
    ['timed_out', '前置传感器等待超时', 'warning']
  ] as const)(
    '格式化 %s 事件',
    (diagnosticEvent, label, level) => {
      const rows = formatLocalRuntimeLog(
        `[UNILAB-ACTION-FEEDBACK] ${JSON.stringify({
          phase: 'waiting_precondition',
          diagnostic_event: diagnosticEvent,
          observed_at: '2026-08-06T04:00:00Z',
          task_uuid: 'task-s04',
          job_uuid: 'job-s04',
          effect: { identity: 'job-s04:1' }
        })}`
      )

      expect(rows[0]?.message).toContain(`${diagnosticEvent} · ${label}`)
      expect(rows[0]?.level).toBe(level)
    }
  )
})
