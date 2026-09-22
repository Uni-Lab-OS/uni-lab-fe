import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StationSnapshot } from '@unilab/services'
import type { RecoveryState } from '../../runtime/WorkflowRecoveryController'
import {
  StationRecovery,
  shouldOpenStationRecoveryDialog,
  stationRecoveryDialogUpdate,
  stationRecoveryNeedsAttention
} from './StationRecovery'

const error = (id: string, stage = 'DECISION_REQUIRED') => ({
  decision_id: id,
  stage
})

function installJsdom(): boolean {
  try {
    const resolved = fileURLToPath(new URL(
      '../../../../../../Uni-Lab-OS/frontend/package.json',
      import.meta.url
    ))
    const fromCwd = `${process.cwd()}/../../../Uni-Lab-OS/frontend/package.json`
    const manifest = existsSync(resolved) ? resolved : fromCwd
    if (!existsSync(manifest)) return false
    const { JSDOM } = createRequire(manifest)('jsdom') as {
      JSDOM: new (html: string, options?: { url?: string }) => { window: Window }
    }
    const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://127.0.0.1/'
    })
    Object.defineProperty(globalThis, 'window', { value: window, configurable: true })
    Object.defineProperty(globalThis, 'document', { value: window.document, configurable: true })
    Object.defineProperty(globalThis, 'HTMLElement', { value: window.HTMLElement, configurable: true })
    Object.defineProperty(globalThis, 'Node', { value: window.Node, configurable: true })
    Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
      value: true,
      configurable: true
    })
    return true
  } catch {
    return false
  }
}

const jsdomReady = installJsdom()

describe('工站异常处置弹窗', () => {
  afterEach(() => {
    if (jsdomReady) document.body.innerHTML = ''
  })

  it('opens for a newly reported station error and keeps the same stage closed', () => {
    const first = stationRecoveryDialogUpdate(new Set(), [error('d1')], 'session-d1')
    expect(first.open).toBe(true)
    expect(first.selectedId).toBe('session-d1')

    const same = stationRecoveryDialogUpdate(first.nextSeen, [error('d1')])
    expect(same.open).toBe(false)

    const next = stationRecoveryDialogUpdate(first.nextSeen, [
      error('d1'),
      error('d2')
    ])
    expect(next.open).toBe(true)
    expect(next.selectedId).toBe('d2')
  })

  it('reopens when the same error enters a new handling stage', () => {
    const deciding = stationRecoveryDialogUpdate(new Set(), [error('d1')])
    const applying = stationRecoveryDialogUpdate(
      deciding.nextSeen,
      [error('d1', 'APPLYING')]
    )
    expect(applying.open).toBe(true)
    expect(applying.selectedId).toBe('d1')
  })

  it('automatically opens the dialog from the station recovery surface', () => {
    const source = readFileSync(new URL('./StationRecovery.tsx', import.meta.url), 'utf8')
    expect(source).toContain('stationRecoveryDialogUpdate')
    expect(source).toContain('shouldOpenStationRecoveryDialog')
    expect(source).toContain('setOpen(true)')
    expect(source).toContain('seenErrors')
    expect(source).not.toMatch(/const \[open, setOpen\] = useState\(false\)/u)
    expect(shouldOpenStationRecoveryDialog({
      unconfirmed: null,
      station: { mode: 'PAUSED', errors: [error('d1')], control_commands: [] } as never
    })).toBe(true)
    expect(stationRecoveryNeedsAttention({
      pending: false,
      unconfirmed: null,
      revision: 0,
      readError: '正在核对工站状态，请稍候'
    })).toBe(false)
  })

  it.skipIf(!jsdomReady)(
    'renders the recovery dialog for a create_batch station error',
    async () => {
      const { createRoot } = await import('react-dom/client')
      const { act } = await import('react')
      const host = document.createElement('div')
      document.body.appendChild(host)
      const root = createRoot(host)
      const state: RecoveryState = {
        station: {
          station_id: 'local',
          mode: 'PAUSED',
          station_version: 1,
          error_epoch: 1,
          snapshot_id: 'local:1:1',
          active_session_id: null,
          active_session: null,
          errors: [{
            decision_id: 'decision-create-batch',
            decision_version: 1,
            source_task_uuid: 'task-1',
            source_job_uuid: 'job-1',
            stage: 'DECISION_REQUIRED',
            status: 'failed',
            meta_data: {
              message: 'create_batch 执行失败',
              source_node_id: 'create_batch'
            }
          }],
          manual_actions: [],
          control_commands: []
        } as StationSnapshot,
        pending: false,
        unconfirmed: null,
        revision: 1
      }
      await act(async () => {
        root.render(
          <StationRecovery
            controller={{
              refresh: vi.fn(),
              submit: vi.fn(),
              retry: vi.fn()
            } as never}
            state={state}
            writable
            workflowName="YB 合成批次（原子动作）"
            nodeNames={{ create_batch: 'create_batch' }}
          />
        )
      })
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      const dialog = document.querySelector('[role="dialog"][aria-labelledby="station-handling-title"]')
      expect(dialog).not.toBeNull()
      expect(dialog?.textContent).toContain('节点执行出错')
      expect(dialog?.textContent).toContain('YB 合成批次（原子动作） · create_batch')
      expect(dialog?.textContent).toContain('create_batch 执行失败')
      expect(dialog?.textContent).toContain('重试当前节点')
      expect(dialog?.textContent).toContain('取消当前任务')
      expect(dialog?.textContent).toContain('进入手动处理')
      expect(dialog?.textContent).toContain('稍后处理')
      root.unmount()
    }
  )
})
