import { describe, expect, it, vi } from 'vitest'

import { getDefaultBackend } from './backends'
import { createInventoryReadPort } from './inventory'
import type { HttpClient } from './http'

describe('inventory read port', () => {
  /** 证明 OS 试剂资源列表保留总量、活动预留量与可用量。 */
  it('maps reagent inventory from the real OS reagent endpoint', async () => {
    const request = vi.fn(async (path: string) => {
      expect(path).toBe('/api/v1/reagents?page=1&page_size=500')
      return {
        code: 0,
        data: {
          items: [{
            uuid: 'reagent-naoh', material_uuid: 'material-naoh',
            reagent_info_uuid: 'info-naoh', revision: 3, meta_data: {},
            name: 'NaOH 1M', physical_state: 'liquid', quantity: 500,
            quantity_unit: 'mL', active_workflow_reserved_quantity: 80,
            container_barcode: 'B-01', container_name: '碱液瓶'
          }]
        }
      }
    })
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.listReagentInventory()).resolves.toEqual([{
      id: 'reagent-naoh',
      materialId: 'material-naoh',
      reagentInfoId: 'info-naoh',
      name: 'NaOH 1M',
      cas: undefined,
      molecularFormula: undefined,
      physicalState: 'liquid',
      totalQuantity: 500,
      availableQuantity: 420,
      reservedQuantity: 80,
      unit: 'mL',
      lotLabel: 'B-01',
      siteLabel: '碱液瓶',
      concentrationValue: undefined,
      concentrationUnit: undefined,
      densityGPerMl: undefined,
      revision: 3,
      description: undefined,
      metadata: {},
      createdAt: undefined,
      updatedAt: undefined,
      status: 'available'
    }])
  })

  /** 证明 Backend 未返回预留维度时保持未知，不由前端伪造为零。 */
  it('keeps missing Backend reservation quantities unknown', async () => {
    const request = vi.fn(async () => ({
      code: 0,
      data: {
        items: [{
          uuid: 'reagent-1', material_uuid: 'material-1',
          reagent_info_uuid: 'info-1', revision: 3, meta_data: {}, name: '乙腈',
          cas: '75-05-8', molecular_formula: 'C2H3N', physical_state: 'liquid',
          quantity: 12.5, quantity_unit: 'mL', container_barcode: 'BOT-01',
          container_name: '乙腈瓶'
        }]
      }
    }))
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    const [item] = await port.listReagentInventory()
    expect(item).toMatchObject({
      id: 'reagent-1',
      materialId: 'material-1',
      name: '乙腈',
      totalQuantity: 12.5,
      status: 'available'
    })
    expect(item.availableQuantity).toBeUndefined()
    expect(item.reservedQuantity).toBeUndefined()
  })

  /** 证明 Backend 试剂库读取全部基础化学字段，并保留服务端未提供的值为空。 */
  it('lists authoritative Backend reagent information for the library view', async () => {
    const request = vi.fn(async (path: string) => {
      expect(path).toBe('/api/v1/reagent-infos?page=1&page_size=100')
      return {
        code: 0,
        data: {
          items: [{
            uuid: 'info-ethanol', name: '乙醇', name_en: 'Ethanol',
            aliases: ['酒精'], cas: '64-17-5', molecular_formula: 'C2H6O',
            smiles: 'CCO', inchi_key: 'LFQSCWFLJHTTHZ-UHFFFAOYSA-N',
            molecular_weight: 46.07, density_g_per_ml: 0.789,
            physical_state: 'liquid', meta_data: { storage: '阴凉通风' },
            create_time: '2026-08-13T00:00:00Z', update_time: '2026-08-13T01:00:00Z'
          }],
          total: 1,
          page: 1,
          page_size: 100
        }
      }
    })
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.listReagentInfos()).resolves.toEqual([{
      id: 'info-ethanol', name: '乙醇', nameEn: 'Ethanol', aliases: ['酒精'],
      cas: '64-17-5', molecularFormula: 'C2H6O', smiles: 'CCO',
      inchiKey: 'LFQSCWFLJHTTHZ-UHFFFAOYSA-N', molecularWeight: 46.07,
      densityGPerMl: 0.789, physicalState: 'liquid',
      metadata: { storage: '阴凉通风' },
      createdAt: '2026-08-13T00:00:00Z', updatedAt: '2026-08-13T01:00:00Z'
    }])
  })

  /** 证明 CAS 预填只读取 Backend 的 PubChem 候选值，并保留隐藏 InChIKey。 */
  it('looks up PubChem candidates through the Backend CAS endpoint', async () => {
    const request = vi.fn(async (path: string) => {
      expect(path).toBe('/api/v1/compounds/64-17-5')
      return {
        code: 0,
        data: {
          cas: '64-17-5',
          status: 'ok',
          compound: {
            name: 'Ethanol',
            molecular_formula: 'C2H6O',
            smiles: 'CCO',
            inchi_key: 'LFQSCWFLJHTTHZ-UHFFFAOYSA-N',
            molecular_weight: 46.07
          }
        }
      }
    })
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.lookupCompoundByCAS('64-17-5')).resolves.toEqual({
      cas: '64-17-5',
      status: 'ok',
      compound: {
        name: 'Ethanol',
        molecularFormula: 'C2H6O',
        smiles: 'CCO',
        inchiKey: 'LFQSCWFLJHTTHZ-UHFFFAOYSA-N',
        molecularWeight: 46.07
      }
    })
  })

  /** 证明化学品字典 CRUD 使用 feat/workflow 的手工登记、三态纠错和受限删除路由。 */
  it('writes Backend reagent information through the feat/workflow contract', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/reagent-infos' && init?.method === 'POST') {
        return {
          code: 0,
          data: reagentInfoResponse('info-new', 'E2E 校准液', 'liquid')
        }
      }
      if (path === '/api/v1/reagent-infos/info-new' && init?.method === 'PUT') {
        return {
          code: 0,
          data: reagentInfoResponse('info-new', 'E2E 校准液（已校正）', 'solid')
        }
      }
      if (path === '/api/v1/reagent-infos/info-new' && init?.method === 'DELETE') {
        return { code: 0 }
      }
      throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`)
    })
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.createReagentInfo({
      name: 'E2E 校准液',
      aliases: ['质控液'],
      physicalState: 'liquid',
      densityGPerMl: 1.02,
      metadata: { source: 'e2e' }
    })).resolves.toMatchObject({ id: 'info-new', name: 'E2E 校准液' })
    await expect(port.updateReagentInfo({
      id: 'info-new',
      name: 'E2E 校准液（已校正）',
      aliases: [],
      physicalState: 'solid'
    })).resolves.toMatchObject({
      id: 'info-new',
      name: 'E2E 校准液（已校正）',
      physicalState: 'solid'
    })
    await expect(port.deleteReagentInfo('info-new')).resolves.toBeUndefined()

    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      cas: '',
      name: 'E2E 校准液',
      aliases: ['质控液'],
      density_g_per_ml: 1.02,
      physical_state: 'liquid',
      meta_data: { source: 'e2e' }
    })
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({
      cas: null,
      name: 'E2E 校准液（已校正）',
      name_en: null,
      aliases: [],
      molecular_formula: null,
      smiles: null,
      inchi_key: null,
      molecular_weight: null,
      density_g_per_ml: null,
      physical_state: 'solid',
      description: null,
      meta_data: {}
    })
  })

  /** 证明 Go Backend 试剂创建、乐观更新和软删除都使用正式 CRUD 路由。 */
  it('writes Backend reagents through the verified CRUD contract', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/reagents' && init?.method === 'POST') {
        return { code: 0, data: { uuid: 'reagent-new', revision: 1 } }
      }
      if (path === '/api/v1/reagents/reagent-new' && init?.method === 'PUT') {
        return { code: 0, data: { uuid: 'reagent-new', revision: 2 } }
      }
      if (path === '/api/v1/reagents/reagent-new' && init?.method === 'DELETE') {
        return { code: 0 }
      }
      throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`)
    })
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.createReagent({
      materialId: 'material-bottle',
      cas: '64-17-5',
      physicalState: 'liquid',
      quantity: 500,
      quantityUnit: 'mL',
      concentrationValue: 95,
      concentrationUnit: '%',
      source: 'frontend:robot-workstation'
    })).resolves.toEqual({ id: 'reagent-new', revision: 1 })
    await expect(port.updateReagent({
      id: 'reagent-new',
      quantity: 450,
      quantityUnit: 'mL',
      expectedRevision: 1,
      concentrationValue: 95,
      concentrationUnit: '%'
    })).resolves.toEqual({ id: 'reagent-new', revision: 2 })
    await expect(port.deleteReagent('reagent-new')).resolves.toBeUndefined()

    const createBody = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    const updateBody = JSON.parse(String(request.mock.calls[1]?.[1]?.body)) as Record<string, unknown>
    expect(createBody).toMatchObject({
      material_uuid: 'material-bottle',
      cas: '64-17-5',
      quantity: 500,
      quantity_unit: 'mL',
      concentration_value: 95,
      concentration_unit: '%'
    })
    expect(updateBody).toMatchObject({
      quantity: 450,
      quantity_unit: 'mL',
      expected_revision: 1
    })
  })

  /** 既有无 CAS 身份使用 UUID 创建库存，且请求不能同时携带 cas。 */
  it('creates a Backend reagent by reagent_info_uuid without cas', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      if (path === '/api/v1/reagents' && init?.method === 'POST') {
        return { code: 0, data: { uuid: 'reagent-demo-1', revision: 1 } }
      }
      throw new Error(`unexpected request ${init?.method ?? 'GET'} ${path}`)
    })
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.createReagent({
      materialId: 'material-bottle',
      reagentInfoId: '11111111-1111-4111-8111-111111111111',
      physicalState: 'unknown',
      quantity: 1,
      quantityUnit: 'g'
    })).resolves.toEqual({ id: 'reagent-demo-1', revision: 1 })

    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      material_uuid: 'material-bottle',
      reagent_info_uuid: '11111111-1111-4111-8111-111111111111',
      physical_state: 'unknown',
      quantity: 1,
      quantity_unit: 'g'
    })
    expect(body).not.toHaveProperty('cas')
  })

  /** 证明试剂历史只接受 Backend 的 reagent 台账主体并保留任务追踪字段。 */
  it('maps immutable Backend reagent history', async () => {
    const request = vi.fn(async () => ({
      code: 0,
      data: {
        items: [{
          uuid: 'history-1', material_uuid: 'material-1',
          subject_type: 'reagent', subject_uuid: 'reagent-1',
          event_type: 'adjust', operator_type: 'frontend',
          quantity_delta: -5, quantity_unit: 'mL', revision: 4,
          workflow_task_uuid: null, workflow_node_job_uuid: null,
          trace_id: 'trace-1', recorded_at: '2026-08-13T00:00:00Z'
        }],
        page: 1,
        page_size: 100,
        has_more: false
      }
    }))
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.listReagentHistory('material-1')).resolves.toEqual({
      items: [{
        id: 'history-1', materialId: 'material-1', reagentId: 'reagent-1',
        eventType: 'adjust', operatorType: 'frontend', quantityDelta: -5,
        quantityUnit: 'mL', revision: 4, workflowTaskId: undefined,
        workflowNodeJobId: undefined, traceId: 'trace-1',
        recordedAt: '2026-08-13T00:00:00Z'
      }],
      page: 1,
      pageSize: 100,
      hasMore: false
    })
  })

  /** 证明 OS profile 直接开放统一试剂删除路由。 */
  it('sends reagent mutations to the OS v1 contract', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe('/api/v1/reagents/reagent-1')
      expect(init?.method).toBe('DELETE')
      return { code: 0 }
    })
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.deleteReagent('reagent-1')).resolves.toBeUndefined()
  })

  /** 证明 OS 试剂资源中的非法数量不会被前端静默归零。 */

  /** 证明试剂分装使用 OS 原子命令，保留幂等身份、源修订和全部目标闭集。 */
  it('dispenses reagent through the OS inventory command contract', async () => {
    const request = vi.fn(async (path: string, init?: RequestInit) => {
      expect(path).toBe('/api/v1/inventory/commands')
      expect(init?.method).toBe('POST')
      return {
        command_id: 'dispense-command-1',
        status: 'completed',
        result: { source_reagent_uuid: 'reagent-1' }
      }
    })
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.dispenseReagent({
      commandId: 'dispense-command-1',
      sourceReagentId: 'reagent-1',
      expectedRevision: 4,
      quantityUnit: 'mL',
      targets: [
        { materialId: 'empty-bottle-1', quantity: 25 },
        { materialId: 'empty-bottle-2', quantity: 30 }
      ],
      reason: '实验分装'
    })).resolves.toEqual({
      commandId: 'dispense-command-1',
      replayed: false
    })

    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({
      command_id: 'dispense-command-1',
      type: 'reagent.dispense',
      actor: 'frontend:robot-workstation',
      payload: {
        source_reagent_uuid: 'reagent-1',
        expected_revision: 4,
        quantity_unit: 'mL',
        targets: [
          { material_uuid: 'empty-bottle-1', quantity: 25 },
          { material_uuid: 'empty-bottle-2', quantity: 30 }
        ],
        reason: '实验分装'
      }
    })
  })

  /** 证明 HTTP 200 中的分装业务拒绝不会被误当成成功。 */
  it('surfaces reagent dispense business rejection', async () => {
    const port = createInventoryReadPort(
      {
        request: vi.fn(async () => ({
          command_id: 'dispense-command-2',
          status: 'rejected',
          error_code: '4002',
          error: '目标容器已有内容物'
        }))
      } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.dispenseReagent({
      commandId: 'dispense-command-2',
      sourceReagentId: 'reagent-1',
      expectedRevision: 4,
      quantityUnit: 'mL',
      targets: [{ materialId: 'occupied-bottle', quantity: 10 }]
    })).rejects.toMatchObject({
      code: '4002',
      message: '目标容器已有内容物'
    })
  })
  it('rejects malformed authoritative quantities', async () => {
    const request = vi.fn(async () => ({
      code: 0,
      data: {
        items: [{
          uuid: 'reagent-x', material_uuid: 'material-x',
          reagent_info_uuid: 'info-x', revision: 1, meta_data: {},
          name: '试剂 X', quantity: '10', quantity_unit: 'mL'
        }]
      }
    }))
    const port = createInventoryReadPort(
      { request } as HttpClient,
      getDefaultBackend('local-python')
    )

    await expect(port.listReagentInventory()).rejects.toMatchObject({
      code: 'INVALID_REAGENT_INVENTORY_RESPONSE'
    })
  })
})

/** 构造满足 Backend ReagentInfo DTO 的最小单测响应。 */
function reagentInfoResponse(id: string, name: string, physicalState: string) {
  return {
    uuid: id,
    name,
    aliases: [],
    physical_state: physicalState,
    meta_data: {}
  }
}
