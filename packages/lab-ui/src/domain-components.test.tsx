import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import {
  DeviceActionList,
  DeviceActionParameterFields,
  DeviceStatusBadge,
  MaterialInspector,
  MaterialSitePresentation,
  ReagentCatalogSummary,
  ReagentQuantitySummary,
  RunPreparationSummary,
  RunSubmitConfirmation,
  WorkflowInputForm,
} from './index'
import type {
  DeviceActionParameter,
  DeviceActionState,
  MaterialGraphNode,
  MaterialInspectionProjection,
  PreflightReport,
  Reagent,
  ReagentInfo,
  RunPreparationViewModel,
  SiteSummary,
  WorkflowInputParameter,
} from '@unilab-fe/core'

const site = (overrides: Partial<SiteSummary> = {}): SiteSummary => ({
  kind: 'site', source: 'os', siteUuid: 'site-1', ownerMaterialUuid: 'material-1', key: 'deck', name: '台面', sortOrder: 1,
  allowedResourceTemplateUuids: null, occupancy: { known: true, occupiedMaterialUuid: null },
  geometry: null, metadata: {}, raw: {}, ...overrides,
})

const action = (overrides: Partial<DeviceActionState> = {}): DeviceActionState => ({
  actionName: 'move', actionRef: 'device-1.move', label: '移动', actionType: 'move',
  actionDefinitionUuid: null, isBusy: false, busyStatusKnown: true, currentJobUuid: null, raw: {}, ...overrides,
})

const parameter = (overrides: Partial<DeviceActionParameter> = {}): DeviceActionParameter => ({
  name: 'target', schema: { type: 'string' }, required: true, title: '目标', ...overrides,
})

describe('lab-ui domain components', () => {
  it('shows device actions, selection and busy status', () => {
    const onSelect = vi.fn()
    const actions = [action({ isBusy: true }), action({ actionRef: 'device-1.stop', label: '停止' })]
    render(<DeviceActionList actions={actions} selectedActionRef="device-1.move" onSelectAction={onSelect} />)
    expect(screen.getByText('执行中')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /移动/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(onSelect).toHaveBeenCalledWith(actions[1])
    render(<DeviceActionList actions={[]} emptyDescription="无动作" />)
    expect(screen.getByText('无动作')).toBeInTheDocument()
  })

  it('renders action fields, converts values and handles empty/edit states', () => {
    const onChange = vi.fn()
    const fields = [parameter(), parameter({ name: 'resource', title: '资源', schema: { $slot: 'ResourceSlot' }, required: false })]
    render(<DeviceActionParameterFields parameters={fields} value={{ target: 'old', resource: '' }} errors={{ target: '必填' }} onChange={onChange} />)
    expect(screen.getByRole('alert')).toHaveTextContent('必填')
    fireEvent.change(screen.getByDisplayValue('old'), { target: { value: 'new' } })
    expect(onChange).toHaveBeenCalledWith('target', 'new')
    const resourceInput = screen.getByPlaceholderText('请输入资源')
    fireEvent.change(resourceInput, { target: { value: 'res-1' } })
    expect(onChange).toHaveBeenCalledWith('resource', 'res-1')
    const { rerender } = render(<DeviceActionParameterFields parameters={fields} value={{}} editable={false} onChange={onChange} />)
    expect(screen.getAllByPlaceholderText('请输入目标').find((element) => element.hasAttribute('disabled'))).toBeDisabled()
    rerender(<DeviceActionParameterFields parameters={[]} value={{}} onChange={onChange} />)
    expect(screen.getByText('该动作没有声明可填写的参数。')).toBeInTheDocument()
  })

  it('maps device dispatch states and explicit labels', () => {
    const base = { online: true, dispatchable: true, dispatchBlockReason: null } as const
    const { rerender } = render(<DeviceStatusBadge device={base} />)
    expect(screen.getByText('在线，可调试')).toBeInTheDocument()
    rerender(<DeviceStatusBadge device={{ online: true, dispatchable: false, dispatchBlockReason: '动作被锁定' }} />)
    expect(screen.getByText('动作被锁定')).toBeInTheDocument()
    rerender(<DeviceStatusBadge device={{ online: false, dispatchable: null, dispatchBlockReason: '边缘离线' }} />)
    expect(screen.getByText('边缘离线')).toBeInTheDocument()
    rerender(<DeviceStatusBadge status="blocked" />)
    expect(screen.getByText('不可调度')).toBeInTheDocument()
    rerender(<DeviceStatusBadge device={base} status="offline" />)
    expect(screen.getByText('离线')).toBeInTheDocument()
    rerender(<DeviceStatusBadge status="unknown" />)
    expect(screen.getByText('状态未知')).toBeInTheDocument()
    rerender(<DeviceStatusBadge status="unknown" label="未连接" />)
    expect(screen.getByText('未连接')).toBeInTheDocument()
  })

  it('selects sites, shows occupancy and supports inspector actions', () => {
    const onOccupied = vi.fn()
    const sites = [site(), site({ siteUuid: 'site-2', key: 'slot', name: '', occupancy: { known: true, occupiedMaterialUuid: 'child-1' } }), site({ siteUuid: 'site-3', key: 'unknown', name: '未知', occupancy: { known: false, occupiedMaterialUuid: null } })]
    render(<MaterialSitePresentation sites={sites} onSelectOccupiedMaterial={onOccupied} />)
    expect(screen.getByRole('option', { name: /slot.*已占用/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /未知.*占用未知/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看 slot 中的物料' }))
    expect(onOccupied).toHaveBeenCalledWith('child-1', 'site-2')
  })

  it('forwards site selection and renders the material presentation empty state', () => {
    const onSelectSite = vi.fn()
    const { rerender } = render(<MaterialSitePresentation sites={[site()]} selectedSiteUuid="site-1" onSelectSite={onSelectSite} />)
    const selected = screen.getByRole('option', { name: /台面.*空闲/ })
    expect(selected).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(selected)
    expect(onSelectSite).toHaveBeenCalledWith('site-1')
    rerender(<MaterialSitePresentation sites={[]} emptyDescription="没有库位" />)
    expect(screen.getByText('没有库位')).toBeInTheDocument()
  })

  it('renders material facts and forwards site selection', () => {
    const node: MaterialGraphNode = {
      material: { kind: 'material_summary', source: 'os', materialUuid: 'material-1', resourceTemplateUuid: 'plate', materialType: 'plate', className: null, parentMaterialUuid: null, barcode: 'BC-1', name: '板', description: null, revision: 1, config: {}, metadata: {}, createdAt: null, updatedAt: null, raw: {} },
      resourceTemplate: { uuid: 'plate', name: 'plate', displayName: '板模板', resourceType: 'labware', raw: {} }, relativePosition: null, sites: [site()], currentSiteUuid: 'site-1', raw: {},
    }
    const projection = { selection: { kind: 'node', materialUuid: 'material-1' }, node, sites: node.sites, selectedSite: null, currentSite: node.sites[0], occupiedSite: null, activeSite: node.sites[0], occupiedSites: [] } as MaterialInspectionProjection
    const onSelect = vi.fn()
    render(<MaterialInspector projection={projection} onSelectSite={onSelect} />)
    expect(screen.getByRole('complementary', { name: '板 物料详情' })).toBeInTheDocument()
    expect(screen.getByText('板模板')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('option', { name: /台面/ }))
    expect(onSelect).toHaveBeenCalledWith('site-1')
  })

  it('forwards an occupied material selection from the material inspector', () => {
    const occupiedSite = site({ siteUuid: 'site-2', key: 'slot', name: '槽位', occupancy: { known: true, occupiedMaterialUuid: 'child-1' } })
    const node: MaterialGraphNode = {
      material: { kind: 'material_summary', source: 'os', materialUuid: 'material-1', resourceTemplateUuid: 'plate', materialType: 'plate', className: null, parentMaterialUuid: null, barcode: null, name: '板', description: null, revision: 1, config: {}, metadata: {}, createdAt: null, updatedAt: null, raw: {} },
      resourceTemplate: null, relativePosition: null, sites: [occupiedSite], currentSiteUuid: occupiedSite.siteUuid, raw: {},
    }
    const projection = { node, sites: node.sites, selectedSite: null, currentSite: occupiedSite } as MaterialInspectionProjection
    const onSelectOccupiedMaterial = vi.fn()
    render(<MaterialInspector projection={projection} onSelectOccupiedMaterial={onSelectOccupiedMaterial} />)
    fireEvent.click(screen.getByRole('button', { name: '查看 槽位 中的物料' }))
    expect(onSelectOccupiedMaterial).toHaveBeenCalledWith('child-1')
  })

  it('renders reagent summaries and status variants', () => {
    const info: ReagentInfo = { kind: 'reagent_info', source: 'os', reagentInfoUuid: 'i-1', name: '乙醇', nameEn: null, aliases: [], cas: null, molecularFormula: null, smiles: null, inchiKey: null, molecularWeight: null, densityGPerMl: null, physicalState: 'liquid', description: null, metadata: {}, createdAt: null, updatedAt: null, raw: {} }
    const reagent: Reagent = { kind: 'reagent', source: 'os', reagentUuid: 'r-1', materialUuid: 'm-1', reagentInfoUuid: 'i-1', name: '乙醇', nameEn: null, cas: null, molecularFormula: null, physicalState: null, quantity: null, quantityUnit: null, reservedQuantity: null, concentrationValue: null, concentrationUnit: null, densityGPerMl: null, densitySource: null, revision: null, materialRevision: null, containerBarcode: null, containerName: null, maximumCapacity: null, configuredCapacity: null, ratedCapacity: null, reagentInfo: info, description: null, metadata: {}, createdAt: null, updatedAt: null, status: 'empty', raw: {} }
    render(<><ReagentCatalogSummary info={info} /><ReagentQuantitySummary reagent={reagent} /></>)
    expect(screen.getByText('未提供英文名')).toBeInTheDocument()
    expect(screen.getByText('未提供')).toBeInTheDocument()
    expect(screen.getByText('空')).toBeInTheDocument()
  })

  it('renders workflow inputs and emits merged form values', () => {
    const onChange = vi.fn()
    const params: WorkflowInputParameter[] = [
      { name: 'count', title: '次数', required: true, schema: { type: 'integer' }, description: '次数说明' },
      { name: 'material', required: false, schema: { $slot: 'ResourceSlot' } },
    ]
    render(<WorkflowInputForm parameters={params} value={{ count: 1 }} errors={{ count: '请填写' }} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('1'), { target: { value: '3' } })
    expect(onChange).toHaveBeenCalledWith({ count: 3 })
    expect(screen.getByRole('alert')).toHaveTextContent('请填写')
    render(<WorkflowInputForm parameters={[]} value={{}} onChange={onChange} />)
    expect(screen.getByText('该工作流没有声明需要填写的运行参数。')).toBeInTheDocument()
  })

  it('renders preflight grouping and submission guard', () => {
    const report: PreflightReport = { kind: 'preflight_report', source: 'os', workflowUuid: 'wf-1', workflowRevision: 2, runMode: 'normal', status: 'invalid', canRun: false, checkedAt: 'now', checks: [
      { type: 'resource', status: 'blocked', code: 'NO_DEVICE', message: '设备不可用', blocking: true, nodeUuid: 'n-1', nodeName: '动作', details: {} },
      { type: 'resource', status: 'confirmation_required', code: 'CONFIRM', message: '需要确认', blocking: false, details: {} },
      { type: 'resource', status: 'deferred', code: 'WAIT', message: '稍后复核', blocking: false, details: {} },
      { type: 'resource', status: 'passed', code: 'OK', message: '通过', blocking: false, details: {} },
    ] }
    const viewModel = { revision: { kind: 'published_revision', source: 'os', workflowUuid: 'wf-1', name: '测试工作流', revision: 3, workflowType: 'workflow', status: 'published', graph: { workflow: {}, nodes: [], edges: [], nodeTemplates: [], handleTemplates: [], inventoryRequirements: [] } }, configuration: { runMode: 'single_node', priority: 'high', description: '', input: { a: 1 } }, binding: { source: 'user', inventoryBindings: [], selectedResources: {} }, requirements: [{ uuid: 'req-1', consumeNodeUuid: 'node-1', requirementKey: 'water', targetType: 'liquid', requiredQuantity: 2, quantityUnit: 'mL', allowSplit: true, description: '纯水', metadata: {} }], nodeJob: null } as unknown as RunPreparationViewModel
    render(<RunPreparationSummary viewModel={viewModel} preflight={report} />)
    expect(screen.getByRole('alert')).toHaveTextContent('当前不能提交')
    expect(screen.getByText('设备不可用')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '库存需求列表' })).toHaveTextContent('2 mL · 可拆分')
    expect(screen.getAllByText('待确认')).toHaveLength(2)
    const submit = vi.fn(); const edit = vi.fn()
    render(<RunSubmitConfirmation canSubmit={false} busy onSubmit={submit} onEdit={edit} />)
    expect(screen.getByRole('button', { name: '提交中…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '返回修改' })).toBeDisabled()
  })

  it('keeps a runnable preflight report quiet when there are no checks', () => {
    const report: PreflightReport = { kind: 'preflight_report', source: 'os', workflowUuid: 'wf-1', workflowRevision: 2, runMode: 'normal', status: 'runnable_now', canRun: true, checkedAt: 'now', checks: [] }
    const viewModel = { revision: { kind: 'published_revision', source: 'os', workflowUuid: 'wf-1', name: '测试工作流', revision: 3, workflowType: 'workflow', status: 'published', graph: { workflow: {}, nodes: [], edges: [], nodeTemplates: [], handleTemplates: [], inventoryRequirements: [] } }, configuration: { runMode: 'normal', priority: 'normal', description: '', input: {} }, binding: { source: 'user', inventoryBindings: [], selectedResources: {} }, requirements: [], nodeJob: null } as unknown as RunPreparationViewModel
    render(<RunPreparationSummary viewModel={viewModel} preflight={report} />)
    expect(screen.getByText('后端没有返回检查项。')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not submit a disabled confirmation and omits the edit action when absent', () => {
    const onSubmit = vi.fn()
    render(<RunSubmitConfirmation canSubmit={false} onSubmit={onSubmit} />)
    const submit = screen.getByRole('button', { name: '提交运行' })
    expect(submit).toBeDisabled()
    expect(screen.queryByRole('button', { name: '返回修改' })).not.toBeInTheDocument()
    fireEvent.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('renders run preparation summary for modes and preflight', () => {
    const viewModel = { revision: { kind: 'published_revision', source: 'os', workflowUuid: 'wf-1', name: '测试工作流', revision: 3, workflowType: 'workflow', status: 'published', graph: { workflow: {}, nodes: [], edges: [], nodeTemplates: [], handleTemplates: [], inventoryRequirements: [] } }, configuration: { runMode: 'single_node', priority: 'high', description: '', input: { a: 1 } }, binding: { source: 'user', inventoryBindings: [], selectedResources: {} }, requirements: [], nodeJob: null } as unknown as RunPreparationViewModel
    render(<RunPreparationSummary viewModel={viewModel} preflight={null} />)
    expect(screen.getByRole('heading', { name: '测试工作流' })).toBeInTheDocument()
    expect(screen.getByText('单节点运行')).toBeInTheDocument()
    expect(screen.getByText('任务名称')).toBeInTheDocument()
    const onSubmit = vi.fn(); const onEdit = vi.fn()
    render(<RunSubmitConfirmation canSubmit onSubmit={onSubmit} onEdit={onEdit} submitLabel="开始" />)
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }))
    fireEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(onEdit).toHaveBeenCalledOnce(); expect(onSubmit).toHaveBeenCalledOnce()
  })
})
