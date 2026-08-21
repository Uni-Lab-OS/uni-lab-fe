import { createRef } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  readWorkbenchRuntimeLog,
  sanitizeWorkbenchRuntimeLog,
  WorkbenchRuntimeLogLauncher
} from './workbench-runtime-log-drawer'
import {
  filterWorkbenchRuntimeLogRows,
  WorkbenchRuntimeLogViewer
} from './workbench-runtime-log-viewer'

describe('WorkbenchRuntimeLogLauncher', () => {
  /** 证明抽屉从固定白名单呈现本地托管进程，而不声称可读取远程服务日志。 */
  it('presents the previous local runtime log drawer affordances', () => {
    const markup = renderToStaticMarkup(
      <WorkbenchRuntimeLogLauncher
        defaultOpen
        onReadLog={vi.fn().mockResolvedValue('')}
        logPaths={{ os: '/tmp/unilab-os.log' }}
        onOpenLog={vi.fn().mockResolvedValue(undefined)}
      />
    )

    expect(markup).toContain('本地调试日志')
    expect(markup).toContain('role="dialog"')
    expect(markup).toContain('工作区数据')
    expect(markup).toContain('设备执行')
    expect(markup).toContain('PLC 模拟器')
    expect(markup).toContain('工作区助手')
    expect(markup).toContain('打开日志文件')
    expect(markup).toContain('关闭本地调试日志')
    expect(markup).toContain('当前日志文件的最新输出')
  })

  /** 证明原版查看器保留级别筛选、结构化行及悬停完整正文。 */
  it('renders severity filters and hover text with structured log rows', () => {
    const warning = '2026-08-14 11:42:01 | WARNING | unilabos.edge - retry device'
    const failure = '2026-08-14 11:42:02 | ERROR | unilabos.edge - action failed'
    const markup = renderToStaticMarkup(
      <WorkbenchRuntimeLogViewer
        instanceId="test"
        dialogRef={createRef<HTMLElement>()}
        contentByKind={{ os: `${warning}\n${failure}` }}
        availableByKind={{ os: true }}
        activeKind="os"
        activeLogPath="/tmp/unilab-os.log"
        loading={false}
        error={null}
        following
        refreshIntervalMs={2_000}
        onFollowChange={vi.fn()}
        onSelect={vi.fn()}
        onRefresh={vi.fn()}
        onOpenFile={vi.fn()}
        onClose={vi.fn()}
      />
    )

    expect(markup).toContain('aria-label="日志级别筛选"')
    expect(markup).toContain('<option value="warning">WARNING</option>')
    expect(markup).toContain('<option value="error">ERROR</option>')
    expect(markup).toContain('data-level="warning"')
    expect(markup).toContain('data-level="error"')
    expect(markup).toContain('title="retry device"')
    expect(markup).toContain('title="action failed"')
  })

  /** 证明终端控制序列不会进入界面或剪贴板，同时保留异常堆栈结构。 */
  it('sanitizes terminal controls without flattening traceback content', () => {
    const content = [
      '\u001b[31mERROR\u001b[0m failed',
      'Traceback (most recent call last):',
      '  File "worker.py", line 7',
      'RuntimeError: boom'
    ].join('\n')

    expect(sanitizeWorkbenchRuntimeLog(content)).toBe([
      'ERROR failed',
      'Traceback (most recent call last):',
      '  File "worker.py", line 7',
      'RuntimeError: boom'
    ].join('\n'))
  })

  /** 证明抽屉只把固定来源枚举交给会话接口，并展示接口返回的安全原文。 */
  it('reads the selected source through the Workbench session boundary', async () => {
    const readLog = vi.fn().mockResolvedValue('\u001b[33mPLC ready\u001b[0m')

    await expect(readWorkbenchRuntimeLog(readLog, 'plc-sim'))
      .resolves.toBe('PLC ready')
    expect(readLog).toHaveBeenCalledWith('plc-sim')
  })

  /** 证明 ERROR 筛选保留 Python traceback，并排除 WARNING 记录。 */
  it('filters warning and error records without flattening traceback', () => {
    const filtered = filterWorkbenchRuntimeLogRows([
      '2026-08-14 11:42:01 | WARNING | unilabos.edge - retry device',
      '2026-08-14 11:42:02 | ERROR | unilabos.edge - action failed',
      'Traceback (most recent call last):',
      '  File "worker.py", line 7',
      'RuntimeError: boom'
    ].join('\n'), 'error')

    expect(filtered.rows).toHaveLength(1)
    expect(filtered.rows[0]?.level).toBe('error')
    expect(filtered.rows[0]?.message).toContain('Traceback (most recent call last):')
    expect(filtered.rows[0]?.message).toContain('RuntimeError: boom')
    expect(filtered.rows[0]?.message).not.toContain('retry device')
  })
})
