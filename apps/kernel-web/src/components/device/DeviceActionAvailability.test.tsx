import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DeviceAction } from '@unilab/services'

import {
  DeviceActionAvailability,
  DeviceLockControl,
  UnlockConfirmationDialog
} from './DevicePanel'

describe('device action Runtime availability', () => {
  it('re-enables the original run control only for a typed D1A Action', () => {
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{ kind: 'ready', message: '参数已就绪' }}
        onRun={() => {}}
      />
    )

    expect(markup).toContain('运行此动作')
    expect(markup).not.toContain('disabled')
    expect(markup).toContain('参数已就绪')
  })

  it('keeps unsupported material contracts fail closed', () => {
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'unavailable',
          reason: 'workflow_required',
          message: '该动作包含物料语义，请在工作流中运行'
        }}
        onRun={() => {}}
      />
    )

    expect(markup).toContain('请在工作流中运行')
    expect(markup).toContain('title="该动作包含物料语义，请在工作流中运行"')
    expect(markup).toContain('aria-describedby=')
    expect(markup).toContain('disabled')
  })

  it.each([
    ['edge_disconnected', 'Edge 未连接', 'Edge 当前未连接'],
    ['device_offline', '设备离线', '设备当前离线'],
    ['catalog_loading', '正在读取动作合同…', '正在读取动作合同目录…'],
    ['catalog_error', '动作合同不可用', '动作合同目录读取失败：连接超时']
  ] as const)(
    '为 %s 直接显示具体状态，不误导为工作流限制',
    (reason, label, message) => {
      const markup = renderToStaticMarkup(
        <DeviceActionAvailability
          state={{ kind: 'unavailable', reason, message }}
          onRun={() => {}}
        />
      )

      expect(markup).toContain(label)
      expect(markup).toContain(message)
      expect(markup).not.toContain('请在工作流中运行')
      expect(markup).toContain('disabled')
    }
  )

  it('separates HTTP acceptance from running and terminal result', () => {
    const pending = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{ kind: 'submitting', message: '正在创建正式任务…' }}
        onRun={() => {}}
      />
    )
    const accepted = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'accepted',
          message: '任务已接受，正在等待设备',
          taskUuid: '10000000-0000-4000-8000-000000000001'
        }}
        onRun={() => {}}
      />
    )
    const succeeded = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'succeeded',
          message: '动作执行完成',
          taskUuid: '10000000-0000-4000-8000-000000000001',
          output: { position: 'safe' }
        }}
        onRun={() => {}}
      />
    )

    expect(pending).toContain('正在创建正式任务')
    expect(pending).toContain('disabled')
    expect(accepted).toContain('任务已接受，正在等待设备')
    expect(accepted).not.toContain('动作执行完成')
    expect(succeeded).toContain('动作执行完成')
    expect(succeeded).toContain('&quot;position&quot;: &quot;safe&quot;')
    expect(succeeded).not.toContain('disabled')
  })

  it('reuses the original execution panel to present feedback as an event stream', () => {
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'running',
          message: '设备正在执行',
          taskUuid: '10000000-0000-4000-8000-000000000001',
          feedback: [{
            uuid: '10000000-0000-4000-8000-000000000010',
            create_time: '2026-08-02T00:00:01Z',
            update_time: '2026-08-02T00:00:01Z',
            meta_data: {},
            workflow_node_job_uuid: '10000000-0000-4000-8000-000000000002',
            sequence: 1,
            feedback_type: 'progress',
            data: { progress: 0.5 },
            observed_at: '2026-08-02T00:00:01Z',
            received_at: '2026-08-02T00:00:01Z',
            idempotency_key: 'feedback-1'
          }]
        }}
        onRun={() => {}}
      />
    )

    expect(markup).toContain('edge-device__execution')
    expect(markup).toContain('Action 运行日志')
    expect(markup).toContain('&quot;events&quot;')
    expect(markup).toContain('&quot;progress&quot;: 0.5')
  })
})

describe('device Action lock controls', () => {
  const busyAction: DeviceAction = {
    actionName: 'move',
    actionRef: 'robot.move',
    displayName: '移动',
    label: '移动',
    typeName: 'RobotMove',
    isBusy: true,
    currentJobId: 'job-active-1234567890',
    schema: null,
    inputSchema: {},
    outputSchema: {},
    riskLevel: 'normal'
  }

  it('shows the existing holder and a discoverable manual unlock action', () => {
    const markup = renderToStaticMarkup(
      <DeviceLockControl
        action={busyAction}
        canForceUnlock
        operation={null}
        onRequestUnlock={() => {}}
      />
    )

    expect(markup).toContain('此动作被设备锁占用')
    expect(markup).toContain('手动解锁')
    expect(markup).toContain('job-acti')
  })

  it('fails closed when Edge reports busy without a holder token', () => {
    const markup = renderToStaticMarkup(
      <DeviceLockControl
        action={{ ...busyAction, currentJobId: null }}
        canForceUnlock
        operation={null}
        onRequestUnlock={() => {}}
      />
    )

    expect(markup).toContain('锁持有者信息缺失')
    expect(markup).not.toContain('手动解锁</button>')
  })

  it('keeps manual unlock unavailable for backends without the capability', () => {
    const markup = renderToStaticMarkup(
      <DeviceLockControl
        action={busyAction}
        canForceUnlock={false}
        operation={null}
        onRequestUnlock={() => {}}
      />
    )

    expect(markup).toContain('此动作被设备锁占用')
    expect(markup).not.toContain('手动解锁</button>')
  })

  it('disables duplicate requests and keeps an actionable error visible', () => {
    const pendingMarkup = renderToStaticMarkup(
      <DeviceLockControl
        action={busyAction}
        canForceUnlock
        operation={{
          actionRef: 'robot.move',
          state: 'pending',
          message: '正在请求 OS 取消当前动作并释放锁…'
        }}
        onRequestUnlock={() => {}}
      />
    )
    const errorMarkup = renderToStaticMarkup(
      <DeviceLockControl
        action={busyAction}
        canForceUnlock
        operation={{
          actionRef: 'robot.move',
          state: 'error',
          message: '设备 Action 锁持有者已变化，请刷新后重新确认'
        }}
        onRequestUnlock={() => {}}
      />
    )

    expect(pendingMarkup).toContain('正在解锁…')
    expect(pendingMarkup).toContain('disabled')
    expect(errorMarkup).toContain('设备 Action 锁持有者已变化')
    expect(errorMarkup).toContain('role="alert"')
  })

  it('shows an OS-confirmed result only after the refreshed Action is free', () => {
    const markup = renderToStaticMarkup(
      <DeviceLockControl
        action={{ ...busyAction, isBusy: false, currentJobId: null }}
        canForceUnlock
        operation={{
          actionRef: 'robot.move',
          state: 'success',
          message: 'OS 已释放 1 个关联 Job，正在复核最新目录状态。'
        }}
        onRequestUnlock={() => {}}
      />
    )

    expect(markup).toContain('动作锁已释放')
    expect(markup).toContain('OS 已释放 1 个关联 Job')
  })

  it('requires explicit physical-safety confirmation in the dialog', () => {
    const markup = renderToStaticMarkup(
      <UnlockConfirmationDialog
        intent={{
          deviceId: 'robot',
          deviceName: '机械臂',
          actionName: 'move',
          actionRef: 'robot.move',
          actionLabel: '移动',
          expectedJobId: 'job-active-1234567890'
        }}
        operation={null}
        onCancel={() => {}}
        onConfirm={() => {}}
      />
    )

    expect(markup).toContain('我已确认设备处于安全状态')
    expect(markup).toContain('确认并解锁')
    expect(markup).toContain('disabled')
  })
})
