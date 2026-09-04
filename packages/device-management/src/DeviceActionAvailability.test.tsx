import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DeviceAction } from '@unilab/services'

import {
  DeviceActionAvailability,
  DeviceLockControl,
  UnlockConfirmationDialog
} from './DevicePanel'
import {
  activeDeviceActionTaskUuid,
  copyDeviceActionTaskId,
  deviceActionReadiness,
  projectDeviceActionTask
} from './DeviceActionAvailability'

describe('device action Runtime availability', () => {
  /** 证明只有非终态的正式任务会进入前端恢复循环。 */
  it('selects only an active WorkflowTask for recovery', () => {
    expect(activeDeviceActionTaskUuid(null)).toBeNull()
    expect(activeDeviceActionTaskUuid({
      actionRef: 'pump-1.dose',
      state: { kind: 'ready', message: '参数已就绪' }
    })).toBeNull()
    expect(activeDeviceActionTaskUuid({
      actionRef: 'pump-1.dose',
      state: {
        kind: 'running',
        message: '设备正在执行',
        taskUuid: '10000000-0000-4000-8000-000000000001'
      }
    })).toBe('10000000-0000-4000-8000-000000000001')
  })

  /** 设备目录缺少实际物料（Material）身份时应在提交前给出通俗提示。 */
  it('disables the run control when the device material identity is missing', () => {
    const state = deviceActionReadiness({
      action: actionFixture(),
      device: {
        id: 'pump-1',
        materialUuid: '',
        resourceTemplateUuid: '20000000-0000-4000-8000-000000000001',
        deviceKey: '/devices/pump-1',
        namespace: '/devices',
        machineName: '本地',
        online: true,
        edgeStatus: 'online',
        dispatchable: true,
        dispatchBlockReason: null,
        executionOccupancies: [],
        actions: [actionFixture()],
        displayName: '一号泵',
        displayDetail: '本地'
      },
      template: null,
      canRunActionTask: true,
      connection: 'connected',
      catalogLoading: false,
      catalogError: null
    })

    expect(state).toEqual({
      kind: 'unavailable',
      reason: 'device_identity_missing',
      message: '当前设备缺少运行标识，请刷新设备列表后重试'
    })
  })

  it('distinguishes an online dispatch block from an offline device', () => {
    const state = deviceActionReadiness({
      action: actionFixture(),
      device: {
        id: 'pump-1',
        materialUuid: '10000000-0000-4000-8000-000000000001',
        deviceKey: '/devices/pump-1',
        namespace: '/devices',
        machineName: '本地',
        online: true,
        edgeStatus: 'online',
        dispatchable: false,
        dispatchBlockReason: 'unresolved_unknown_command:workflow-node-job:old-job',
        executionOccupancies: [],
        actions: [actionFixture()],
        displayName: '一号泵',
        displayDetail: '本地'
      },
      template: null,
      canRunActionTask: true,
      connection: 'connected',
      catalogLoading: false,
      catalogError: null
    })

    expect(state).toEqual({
      kind: 'unavailable',
      reason: 'dispatch_blocked',
      message: '设备在线，但存在未确认的历史命令；完成安全核验后才能运行'
    })
  })

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
    expect(markup).toContain('disabled')
  })

  /**
   * 验证只有调用方已经识别出明确 UNKNOWN 阻断时才呈现一键人工确认入口。
   *
   * @returns 无返回值；通过按钮文案、位置顺序和等待状态断言展示边界。
   * @throws 普通阻断误显示入口或处理中仍允许重复提交时由断言报告失败。
   * @safety 静态渲染不会调用结算接口，也不会接触真实设备。
   */
  it('renders the one-click UNKNOWN settlement beside the block message', () => {
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'unavailable',
          reason: 'dispatch_blocked',
          message: '设备在线，但存在未确认的历史命令；完成安全核验后才能运行'
        }}
        onRun={() => {}}
        onResolveUnknown={() => {}}
      />
    )
    const pendingMarkup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'unavailable',
          reason: 'dispatch_blocked',
          message: '设备在线，但存在未确认的历史命令；完成安全核验后才能运行'
        }}
        onRun={() => {}}
        onResolveUnknown={() => {}}
        resolvingUnknown
      />
    )

    expect(markup).toContain('人工确认并解除阻断')
    expect(markup.indexOf('完成安全核验')).toBeLessThan(
      markup.indexOf('人工确认并解除阻断')
    )
    expect(pendingMarkup).toContain('正在等待物理结算')
    expect(pendingMarkup).toMatch(/正在等待物理结算[^<]*<\/button>/u)
    expect(pendingMarkup).toContain('disabled')
  })

  /** 验证动作信息读取失败时只展示通俗说明，不泄露内部“合同”术语。 */
  it('用通俗文案说明动作信息读取失败', () => {
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'unavailable',
          reason: 'catalog_error',
          message: '无法读取该动作的运行信息，请刷新后重试'
        }}
        onRun={() => {}}
      />
    )

    expect(markup).toContain('暂时无法运行')
    expect(markup).not.toContain('请在工作流中运行')
    expect(markup).not.toContain('合同')
    expect(markup).toContain('无法读取该动作的运行信息，请刷新后重试')
  })

  /** 验证旧 OS 返回技术术语时，最终渲染边界仍转换为用户可理解的动作信息。 */
  it('过滤上游错误中的内部术语', () => {
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'unavailable',
          reason: 'catalog_error',
          message: 'Action 合同目录不可用：响应无效'
        }}
        onRun={() => {}}
      />
    )

    expect(markup).not.toContain('合同')
    expect(markup).toContain('设备动作信息不可用：响应无效')
  })

  /** 验证零动作设备沿用正式运行入口，并以禁用状态解释不可执行原因。 */
  it('keeps the run entry disabled when a device reports zero actions', () => {
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'unavailable',
          reason: 'no_actions',
          message: '该设备没有可运行的动作'
        }}
        disabledRunLabel="运行此动作"
        onRun={() => {}}
      />
    )

    expect(markup).toContain('运行此动作')
    expect(markup).toContain('disabled')
    expect(markup).toContain('该设备没有可运行的动作')
  })

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

  it('复制完整 Task ID，而不是界面中的缩略值', async () => {
    const writeText = vi.fn(async () => {})
    const taskUuid = '10000000-0000-4000-8000-000000000001'

    await copyDeviceActionTaskId(taskUuid, { writeText })

    expect(writeText).toHaveBeenCalledWith(taskUuid)
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{ kind: 'running', message: '设备正在执行', taskUuid }}
        onRun={() => {}}
      />
    )
    expect(markup).toContain('aria-label="复制完整 Task ID"')
    expect(markup).toContain('Task 10000000…000001')
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

  it('shows the latest device wait reason when the action reports one', () => {
    const state = projectDeviceActionTask({
      task_uuid: '10000000-0000-4000-8000-000000000001',
      job_uuid: '10000000-0000-4000-8000-000000000002',
      status: 'running',
      control_status: 'active',
      cleanup_status: 'none',
      output: {},
      error_info: [],
      job_status: 'running',
      feedback_cursor: 1
    }, [{
      uuid: '10000000-0000-4000-8000-000000000010',
      create_time: '2026-08-02T00:00:01Z',
      update_time: '2026-08-02T00:00:01Z',
      meta_data: {},
      workflow_node_job_uuid: '10000000-0000-4000-8000-000000000002',
      sequence: 1,
      feedback_type: 'progress',
      data: { message: '等待 S04 搅拌位物料在位' },
      observed_at: '2026-08-02T00:00:01Z',
      received_at: '2026-08-02T00:00:01Z',
      idempotency_key: 'feedback-wait'
    }])

    expect(state.message).toBe('等待 S04 搅拌位物料在位')
  })

  it('distinguishes a completed device job from OS task cleanup', () => {
    const state = projectDeviceActionTask({
      task_uuid: '10000000-0000-4000-8000-000000000001',
      job_uuid: '10000000-0000-4000-8000-000000000002',
      status: 'running',
      control_status: 'active',
      cleanup_status: 'running',
      output: { position: 'safe' },
      error_info: [],
      job_status: 'succeeded',
      feedback_cursor: 0
    }, [])

    expect(state).toMatchObject({
      kind: 'finishing',
      message: '设备动作已完成，OS 正在确认收尾'
    })
  })
})

/** 构造设备页动作（Action）展示夹具。 */
function actionFixture(): DeviceAction {
  return {
    actionName: 'dose',
    actionRef: 'pump-1.dose',
    displayName: '加液',
    label: '加液',
    typeName: 'Dose',
    isBusy: false,
    currentJobId: null,
    schema: null,
    inputSchema: {},
    outputSchema: {},
    riskLevel: 'normal'
  }
}

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

  it('announces action submission errors as alerts', () => {
    const markup = renderToStaticMarkup(
      <DeviceActionAvailability
        state={{
          kind: 'error',
          message: '提交内容格式不正确',
          retryable: false
        }}
        onRun={() => undefined}
      />
    )

    expect(markup).toContain('is-error')
    expect(markup).toContain('role="alert"')
    expect(markup).toContain('提交内容格式不正确')
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
