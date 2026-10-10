import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { PreflightCheck, ResourceCandidate } from '@unilab-fe/core'
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
