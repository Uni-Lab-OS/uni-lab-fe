import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowInterventions, WorkflowInterventionsView } from './WorkflowInterventions'
import type { WorkflowRuntimePort } from '@unilab/services'
import type { InterventionViewState } from '../utils/workflowInterventionController'
const props = { onMinimize: vi.fn(), onRestore: vi.fn(), onRetry: vi.fn(), onDecide: vi.fn() }
const state: InterventionViewState = { minimized: false, busy: null, error: null, messages: { i1: 'TCP <script>alert(1)</script>' },
  items: [{ uuid: 'i1', workflow_task_uuid: 't1', workflow_node_job_uuid: 'j1', revision: 1, status: 'open',
    meta_data: {}, options: [{ id: 'retry', label: '重试' }], delivery_status: 'none' }] }
describe('intervention view', () => {
  it('blocks malformed loading data instead of exposing a generic confirm option', () => {
    const html = renderToStaticMarkup(<WorkflowInterventionsView {...props} state={{ ...state,
      items: [{ ...state.items[0]!, options: [{ id: 'confirm_loading', label: 'confirm-bypass' }], meta_data: {} }] }} />)
    expect(html).toContain('入库明细格式不完整')
    expect(html).not.toContain('confirm-bypass')
    expect(html).toContain('待处理事项')
  })

  it('routes loading snapshots to a neutral persistent dialog without losing other interventions', () => {
    const loading = { ...state.items[0]!, options: [{ id: 'confirm_loading' }], meta_data: { loading: {
      schema_version: 1, request_uuid: 'request', revision: 1,
      rows: [{ key: 'row', instrument: { id: 'instrument', label: '仪器' }, site: { id: 'site', label: '库位' },
        material: { identity: 'planned', label: '容器' }, quantity: 1, unit: '块', availability: { allowed: true } }]
    } } }
    const html = renderToStaticMarkup(<WorkflowInterventionsView {...props} state={{ ...state,
      items: [loading, { ...state.items[0]!, uuid: 'other' }] }} />)
    expect(html).toContain('计划物料，尚未入库')
    expect(html).toContain('其他干预与读取信息（1）')
    expect(html).toContain('确认已放置')
  })

  it('renders no offline popup for an unsupported profile', () => {
    expect(renderToStaticMarkup(<WorkflowInterventions runtime={{} as WorkflowRuntimePort} online={false} />)).toBe('')
  })
  it('offers frozen replay only when the original key is still available', () => {
    const selected = { ...state, items: [{ ...state.items[0]!, status: 'selected' as const,
      selected_option_id: 'retry', delivery_status: 'unknown' as const }] }
    const replay = renderToStaticMarkup(<WorkflowInterventionsView {...props} state={{ ...selected, replayable: ['i1'] }} />)
    expect(replay).toContain('重投已选处理')
    const restored = renderToStaticMarkup(<WorkflowInterventionsView {...props} state={selected} />)
    expect(restored).not.toContain('重投已选处理')
    expect(restored).toContain('投递结果尚未确认')
    expect(restored).not.toContain('幂等键')
  })

  it('renders accessible TCP error and minimize control without close/dismiss', () => {
    const html = renderToStaticMarkup(<WorkflowInterventionsView {...props} state={state} />)
    expect(html).toContain('role="dialog"'); expect(html).toContain('最小化')
    expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>')
    expect(html).not.toContain('关闭'); expect(html).not.toContain('取消')
  })
  it('retains recoverable small window when minimized', () => {
    const html = renderToStaticMarkup(<WorkflowInterventionsView {...props} state={{ ...state, minimized: true }} />)
    expect(html).toContain('恢复干预窗口'); expect(html).toContain('仍有干预等待处理')
  })
  it('disables decisions after accepted and labels waiting rather than resolved', () => {
    const html = renderToStaticMarkup(<WorkflowInterventionsView {...props} state={{ ...state,
      items: [{ ...state.items[0]!, status: 'selected', delivery_status: 'accepted' }] }} />)
    expect(html).toContain('等待动作结果'); expect(html).toContain('disabled=""')
  })
  it('keeps initial-load error discoverable with retry even without known items', () => {
    const html = renderToStaticMarkup(<WorkflowInterventionsView {...props} state={{ ...state, items: [], error: '503' }} />)
    expect(html).toContain('role="alert"'); expect(html).toContain('重新读取')
  })
})
