import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkflowLoadingDialog, type WorkflowLoadingDialogProps } from './WorkflowLoadingDialog'
import { loadingConfirmationDisabledReason, type WorkflowLoadingView } from '../utils/workflowLoadingView'

const view: WorkflowLoadingView = { title: '人工入库', status: 'open', deliveryStatus: 'none', rows: [
  { key: 'row', instrument: { id: 'instrument', label: '通用仪器' }, site: { id: 'site', label: '可用库位' },
    material: { identity: 'planned', label: '待确认容器' }, quantity: 1, unit: '块', availability: { allowed: true } }
] }
const props: WorkflowLoadingDialogProps = { view, online: true, busy: false, minimized: false,
  error: null, onMinimize: vi.fn(), onRestore: vi.fn(), onRefresh: vi.fn() }

describe('neutral loading dialog', () => {
  it('retains the dialog and announces pending confirmation before any authoritative update', () => {
    const html = renderToStaticMarkup(<WorkflowLoadingDialog {...props} busy onConfirm={vi.fn()} />)
    expect(html).toContain('正在提交入库确认，请等待服务结果')
    expect(html).toContain('role="dialog"')
    expect(html).toContain('计划物料，尚未入库')
    expect(html).toContain('disabled=""')
    expect(html).not.toContain('关闭')
  })

  it('keeps planned identity explicit and disables confirmation without a service capability', () => {
    const html = renderToStaticMarkup(<WorkflowLoadingDialog {...props} />)
    expect(html).toContain('计划物料，尚未入库')
    expect(html).toContain('当前服务尚未提供入库确认能力')
    expect(html).toContain('最小化')
    expect(html).not.toContain('取消')
    expect(html).not.toContain('关闭')
    expect(html).toContain('窗口宽度百分比')
    expect(html).toContain('窗口高度百分比')
  })
  it('retains the restore entry and escaped error while offline and minimized', () => {
    const html = renderToStaticMarkup(<WorkflowLoadingDialog {...props} minimized online={false} error={'TCP <failed>'} />)
    expect(html).toContain('恢复入库窗口')
    expect(html).toContain('连接离线，入库事项仍保留')
    expect(html).toContain('TCP &lt;failed&gt;')
  })
  it('does not treat accepted as updated inventory', () => {
    const html = renderToStaticMarkup(<WorkflowLoadingDialog {...props} onConfirm={vi.fn()}
      view={{ ...view, status: 'selected', deliveryStatus: 'accepted' }} />)
    expect(html).toContain('等待服务更新库存')
    expect(html).toContain('disabled=""')
    expect(html).toContain('计划物料，尚未入库')
  })
  it('requires live authority, valid quantities and all target availability before confirmation', () => {
    expect(loadingConfirmationDisabledReason(view, true, false, true)).toBeNull()
    expect(loadingConfirmationDisabledReason(view, false, false, true)).toContain('离线')
    expect(loadingConfirmationDisabledReason(view, true, true, true)).toContain('正在提交')
    expect(loadingConfirmationDisabledReason({ ...view, rows: [] }, true, false, true)).toContain('明细')
    expect(loadingConfirmationDisabledReason({ ...view, rows: [{ ...view.rows[0]!, quantity: NaN }] }, true, false, true)).toContain('数量')
    expect(loadingConfirmationDisabledReason({ ...view, rows: [{ ...view.rows[0]!, availability: { allowed: false, reason: '库位已被占用' } }] }, true, false, true)).toBe('库位已被占用')
  })
})
