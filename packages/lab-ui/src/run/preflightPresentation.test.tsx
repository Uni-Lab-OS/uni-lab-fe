import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { PreflightCheck, PreflightReport, ResourceCandidate } from '@unilab-fe/core'
import { formatPreflightCheckMessage } from './preflightPresentation'
import { PreflightReportView } from './PreflightReportView'

const material: ResourceCandidate = {
  kind: 'resource_candidate',
  id: 'd53dbdb4-06be-58d4-8c1e-b7e6f314fdf9',
  resourceKind: 'material',
  label: '来源容器 R1C4',
  status: null,
  source: 'os',
  observedAt: null,
  metadata: {
    reagent_name: '乙醇',
    container_name: '来源容器 R1C4',
  },
}

const check = (overrides: Partial<PreflightCheck> = {}): PreflightCheck => ({
  type: 'quantity_inventory',
  status: 'blocked',
  code: 'quantity_inventory_unavailable',
  message: '来源容器 d53dbdb4-06be-58d4-8c1e-b7e6f314fdf9 没有试剂或当前内容物数量',
  blocking: true,
  details: {},
  ...overrides,
})

describe('formatPreflightCheckMessage', () => {
  it('shows reagent and container names for an insufficient inventory check', () => {
    const message = formatPreflightCheckMessage(check(), [material])

    expect(message).toBe('试剂“乙醇”在容器“来源容器 R1C4”中没有可用数量')
    expect(message).not.toContain(material.id)
  })

  it('replaces resource UUIDs in other preflight messages', () => {
    const message = formatPreflightCheckMessage(
      check({ code: 'device_dispatch_recheck_required', message: `设备 ${material.id} 需要复核` }),
      [material],
    )

    expect(message).toBe('设备 来源容器 R1C4 需要复核')
  })

  it('masks an unresolved UUID instead of showing it directly', () => {
    const message = formatPreflightCheckMessage(
      check({ message: '来源容器 11111111-1111-4111-8111-111111111111 不可用' }),
    )

    expect(message).toBe('来源容器 相关资源 不可用')
  })

  it('renders the human-readable message in the preflight panel', () => {
    render(
      <PreflightReportView
        report={{
          kind: 'preflight_report',
          source: 'os',
          workflowUuid: 'wf-1',
          workflowRevision: 1,
          runMode: 'normal',
          status: 'temporarily_unavailable',
          canRun: false,
          checkedAt: 'now',
          checks: [check()],
        }}
        candidates={[material]}
      />,
    )

    expect(screen.getByText('试剂“乙醇”在容器“来源容器 R1C4”中没有可用数量')).toBeInTheDocument()
    expect(screen.queryByText(new RegExp(material.id))).not.toBeInTheDocument()
  })
})

describe('PreflightReportView grouping', () => {
  // 分组标题在 <summary> 里；每行右侧的状态标签也用同样的文字。
  const groupOf = (title: string) =>
    screen
      .getAllByText(title)
      .find((element) => element.parentElement?.tagName === 'SUMMARY')!
      .closest('details')!
  const report = (checks: PreflightCheck[]): PreflightReport => ({
    kind: 'preflight_report',
    source: 'os',
    workflowUuid: 'wf-1',
    workflowRevision: 1,
    runMode: 'normal',
    status: 'runnable_now',
    canRun: true,
    checkedAt: 'now',
    checks,
  })
  const deferred = (code: string, message: string, index: number): PreflightCheck =>
    check({
      type: 'device_selection',
      status: 'deferred',
      code,
      message,
      blocking: false,
      nodeUuid: `node-${code}-${index}`,
      nodeName: index % 2 === 0 ? '移动到点位' : '工具动作',
    })

  it('summarizes informational checks by code instead of listing every node', () => {
    // 现场并行全流程：每个设备节点各有两条派发时复核说明，另有一条全局资源说明。
    const checks = [
      ...Array.from({ length: 5_065 }, (_, index) =>
        deferred(
          'device_instance_selected_at_dispatch',
          '未装配设备注册读取端口，将在派发门禁复核',
          index,
        ),
      ),
      ...Array.from({ length: 5_063 }, (_, index) =>
        deferred(
          'device_dispatch_recheck_required',
          '设备在线状态与动作能力将在派发时原子复核',
          index,
        ),
      ),
      check({
        type: 'resource_lock',
        status: 'deferred',
        code: 'resource_admission_at_dispatch',
        message: '资源将在派发门禁复核',
        blocking: false,
      }),
    ]
    render(<PreflightReportView report={report(checks)} />)

    const group = groupOf('待复核')
    expect(within(group).getByText('3 类 · 10,129 项')).toBeInTheDocument()
    expect(group.querySelectorAll('li')).toHaveLength(3)
    expect(
      screen.getByText('device_instance_selected_at_dispatch · 5,065 个节点'),
    ).toBeInTheDocument()
    expect(screen.getByText('resource_admission_at_dispatch')).toBeInTheDocument()
    // 节点名单在展开前不渲染。
    expect(screen.queryByText(/移动到点位 ×/)).not.toBeInTheDocument()
  })

  it('lists node names with repeat counts only after expanding a summary', () => {
    const checks = Array.from({ length: 5 }, (_, index) =>
      deferred(
        'device_dispatch_recheck_required',
        '设备在线状态与动作能力将在派发时原子复核',
        index,
      ),
    )
    render(<PreflightReportView report={report(checks)} />)

    const toggle = screen.getByRole('button', { name: '查看节点' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(screen.getByText('移动到点位 ×3、工具动作 ×2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起节点' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('keeps blocking and confirmation checks itemized', () => {
    const checks = [
      check({
        code: 'device_currently_unavailable',
        message: '机械臂离线',
        nodeUuid: 'a',
        nodeName: '取板',
      }),
      check({
        code: 'device_currently_unavailable',
        message: '机械臂离线',
        nodeUuid: 'b',
        nodeName: '放板',
      }),
      check({
        type: 'manual_confirmation',
        status: 'confirmation_required',
        code: 'manual_confirmation_required',
        message: '运行到该节点时需要人工确认',
        blocking: false,
        nodeUuid: 'c',
        nodeName: '确认排液',
      }),
    ]
    render(<PreflightReportView report={{ ...report(checks), canRun: false }} />)

    const blocked = groupOf('阻塞项')
    expect(blocked.querySelectorAll('li')).toHaveLength(2)
    expect(within(blocked).getByText('2')).toBeInTheDocument()
    expect(within(groupOf('待确认')).getByText(/确认排液/)).toBeInTheDocument()
  })
})
