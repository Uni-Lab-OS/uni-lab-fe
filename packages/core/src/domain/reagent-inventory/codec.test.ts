import { describe, expect, it } from 'vitest'
import {
  decodeCompoundLookup,
  decodeInventorySnapshot,
  decodeInventoryInstances,
  decodeReagent,
  decodeReagentBatchResult,
  decodeReagentDispenseResult,
  decodeReagentHistoryPage,
  decodeReagentInfo,
  decodeReagentStructure3d,
  encodeReagentDraft,
  encodeReagentInfoPatch,
  encodeReagentPatch,
} from './codec'
import { ReagentInventoryError } from './errors'

describe('reagent inventory codec', () => {
  it('keeps backend quantities and reservation dimensions unknown when omitted', () => {
    expect(
      decodeReagent({
        uuid: 'reagent-1',
        material_uuid: 'material-1',
        reagent_info_uuid: 'info-1',
        name: '乙腈',
        quantity: 10,
        quantity_unit: 'mL',
        meta_data: {},
        revision: 3,
      }),
    ).toMatchObject({
      reagentUuid: 'reagent-1',
      quantity: 10,
      reservedQuantity: null,
      status: 'available',
    })
  })

  it('maps the reagent information identity without inventing aliases or metadata', () => {
    expect(
      decodeReagentInfo({
        uuid: 'info-1',
        name: '乙腈',
        aliases: ['acetonitrile'],
        physical_state: 'liquid',
      }),
    ).toMatchObject({
      reagentInfoUuid: 'info-1',
      aliases: ['acetonitrile'],
      physicalState: 'liquid',
      metadata: {},
    })
  })

  it('maps the complete edge snapshot and derives only observable lot status', () => {
    const snapshot = decodeInventorySnapshot({
      snapshot_sequence: 8,
      templates: [
        {
          template_id: 'reagent-naoh',
          name: 'NaOH',
          category: 'reagent',
          spec_json: '{}',
          version: 1,
        },
      ],
      lots: [
        {
          lot_id: 'lot-empty',
          template_id: 'reagent-naoh',
          quantity_total: 0,
          quantity_available: 0,
          quantity_reserved: 0,
          quarantined: 0,
          version: 1,
        },
        {
          lot_id: 'lot-reserved',
          template_id: 'reagent-naoh',
          quantity_total: 10,
          quantity_available: 0,
          quantity_reserved: 10,
          quarantined: 0,
          version: 1,
        },
        {
          lot_id: 'lot-quarantined',
          template_id: 'reagent-naoh',
          quantity_total: 10,
          quantity_available: 10,
          quantity_reserved: 0,
          quarantined: 1,
          version: 1,
        },
      ],
      instances: [
        {
          edge_uuid: 'instance-1',
          template_id: 'reagent-naoh',
          status: 'available',
          version: 1,
          relation: { parent_uuid: 'deck-1', slot_id: 'A1', child_uuid: 'instance-1', version: 1 },
        },
      ],
      relations: [{ parent_uuid: 'deck-1', slot_id: 'A1', child_uuid: 'instance-1', version: 1 }],
      contents: [{ instance_uuid: 'instance-1', state_json: '{}', version: 1 }],
      reservations: [
        {
          reservation_id: 'reservation-1',
          workflow_id: 'workflow-1',
          node_id: 'node-1',
          attempt: 0,
          status: 'active',
          amounts_json: '{}',
          created_at: 10,
          version: 1,
        },
      ],
    })

    expect(snapshot).toMatchObject({
      snapshotSequence: 8,
      lots: [
        { lotId: 'lot-empty', status: 'empty' },
        { lotId: 'lot-reserved', status: 'reserved' },
        { lotId: 'lot-quarantined', status: 'quarantined' },
      ],
      instances: [{ instanceUuid: 'instance-1', relation: { slotId: 'A1' } }],
      reservations: [{ reservationId: 'reservation-1', attempt: 0 }],
    })
  })

  it('accepts the direct edge instance list response and rejects string quantities', () => {
    expect(
      decodeInventoryInstances({
        instances: [{ edge_uuid: 'instance-1', template_id: 'vial', status: 'available' }],
      }),
    ).toMatchObject([{ instanceUuid: 'instance-1' }])
    expect(() =>
      decodeReagent({
        uuid: 'reagent-1',
        material_uuid: 'material-1',
        reagent_info_uuid: 'info-1',
        name: '乙腈',
        quantity: '10',
        meta_data: {},
        revision: 1,
      }),
    ).toThrow('reagent.quantity must be a finite number')
  })

  it('reads the empty strings OS uses for absent instance fields as unknown', () => {
    expect(
      decodeInventoryInstances({
        instances: [
          {
            edge_uuid: 'instance-1',
            legacy_cloud_id: '',
            lot_id: '',
            template_id: 'vial',
            barcode: 'UNILAB-GRAPH-01',
            status: 'warehouse',
            version: 1,
            parent_uuid: '',
          },
        ],
      }),
    ).toMatchObject([
      { instanceUuid: 'instance-1', legacyCloudId: null, lotId: null, parentUuid: null },
    ])
  })

  it('keeps each capacity layer separate and an undeclared layer unknown', () => {
    expect(
      decodeReagent({
        uuid: 'reagent-1',
        material_uuid: 'material-1',
        reagent_info_uuid: 'info-1',
        name: '乙醇',
        meta_data: {},
        revision: 1,
        quantity: 500,
        quantity_unit: 'mL',
        density_g_per_ml: 0.789,
        density_source: 'dictionary',
        material_revision: 2,
        configured_capacity: { max_volume_ul: 1000000 },
        maximum_capacity: { max_volume_ul: 1000000 },
        rated_capacity: {},
        reagent_info: { uuid: 'info-1', name: '乙醇', aliases: [], physical_state: 'liquid' },
      }),
    ).toMatchObject({
      densitySource: 'dictionary',
      materialRevision: 2,
      configuredCapacity: { maxVolumeUl: 1000000, maxMassG: null },
      maximumCapacity: { maxVolumeUl: 1000000 },
      ratedCapacity: null,
      reagentInfo: { reagentInfoUuid: 'info-1' },
    })
  })

  it('treats a missing compound as manual-entry guidance instead of a failure', () => {
    expect(
      decodeCompoundLookup({
        cas: '75-05-8',
        status: 'not_found',
        message: '化合物数据源没有收录该 CAS，请手工填写化学信息',
      }),
    ).toMatchObject({ status: 'not_found', compound: null })
    expect(
      decodeCompoundLookup({
        cas: '64-17-5',
        status: 'ok',
        compound: {
          name: 'Ethanol',
          molecular_formula: 'C2H6O',
          smiles: 'CCO',
          molecular_weight: 46.07,
        },
      }),
    ).toMatchObject({
      status: 'ok',
      compound: { name: 'Ethanol', molecularWeight: 46.07, densityGPerMl: null },
    })
    expect(() => decodeCompoundLookup({ cas: '64-17-5', status: 'guessed' })).toThrow(
      'compound.status guessed is not a known lookup status',
    )
  })

  it('keeps a not-yet-generated 3D structure pending without inventing content', () => {
    expect(
      decodeReagentStructure3d({
        reagent_info_uuid: 'info-1',
        identity_key: '',
        format: '',
        source: '',
        source_id: null,
        content: null,
        checksum: null,
        status: 'pending',
        generated_at: null,
        error_message: null,
        update_time: '2026-09-29T06:33:44.446Z',
      }),
    ).toMatchObject({
      status: 'pending',
      content: null,
      identityKey: null,
      format: null,
      structureSource: null,
    })
  })

  it('preserves the causation grouping and signed delta of the reagent ledger', () => {
    const page = decodeReagentHistoryPage({
      code: 0,
      data: {
        items: [
          {
            uuid: 'entry-1',
            material_uuid: 'material-1',
            event_type: 'dispense_source',
            operator_type: 'developer-web',
            causation_id: 'dispense-1',
            changes: { result: { quantity: 400 } },
            extension: { target_reagent_uuids: ['reagent-2'] },
            trace_id: null,
            recorded_at: '2026-09-29T06:34:58.128Z',
            workflow_task_uuid: null,
            workflow_node_job_uuid: null,
            subject_type: 'reagent',
            subject_uuid: 'reagent-1',
            quantity_delta: -100,
            quantity_unit: 'mL',
            revision: 2,
          },
        ],
        page: 1,
        page_size: 20,
        has_more: false,
      },
    })

    expect(page).toMatchObject({
      hasMore: false,
      items: [
        {
          eventType: 'dispense_source',
          causationId: 'dispense-1',
          quantityDelta: -100,
          workflowTaskUuid: null,
          extension: { target_reagent_uuids: ['reagent-2'] },
        },
      ],
    })
  })

  it('reports partial batch imports with their row-level errors', () => {
    expect(
      decodeReagentBatchResult({
        code: 0,
        data: {
          total: 2,
          created: 1,
          failed: 1,
          atomic: false,
          items: [
            {
              uuid: 'reagent-1',
              material_uuid: 'material-1',
              reagent_info_uuid: 'info-1',
              name: '乙醇',
              meta_data: {},
              revision: 1,
            },
          ],
          errors: [{ row: 2, errors: [{ field: 'quantity', message: '字段无效' }] }],
        },
      }),
    ).toMatchObject({
      total: 2,
      created: 1,
      failed: 1,
      atomic: false,
      items: [{ reagentUuid: 'reagent-1' }],
      errors: [{ row: 2, errors: [{ field: 'quantity', message: '字段无效' }] }],
    })
  })

  it('keeps the row details of a rejected atomic import on the error', () => {
    try {
      decodeReagentBatchResult({
        code: 1000,
        error: {
          msg: '批量导入校验失败，未写入任何数据',
          details: {
            total: 2,
            created: 0,
            failed: 1,
            errors: [{ row: 2, errors: [{ message: '字段无效' }] }],
          },
        },
      })
      expect.unreachable('rejected import must throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ReagentInventoryError)
      expect(error as ReagentInventoryError).toMatchObject({
        code: 'OS_REQUEST_REJECTED',
        osCode: 1000,
        details: { failed: 1 },
      })
    }
  })

  it('reads the unenveloped dispense command result and keeps the rejection reason', () => {
    expect(
      decodeReagentDispenseResult({
        command_id: 'dispense-1',
        status: 'completed',
        result: {
          source: {
            reagent_uuid: 'reagent-1',
            material_uuid: 'material-1',
            quantity: 400,
            quantity_unit: 'mL',
            revision: 2,
          },
          targets: [
            {
              reagent_uuid: 'reagent-2',
              material_uuid: 'material-2',
              quantity: 100,
              quantity_unit: 'mL',
              revision: 1,
            },
          ],
        },
      }),
    ).toMatchObject({
      status: 'completed',
      errorCode: null,
      sourceLine: { reagentUuid: 'reagent-1', quantity: 400, revision: 2 },
      targets: [{ reagentUuid: 'reagent-2', quantity: 100 }],
    })

    expect(
      decodeReagentDispenseResult({
        command_id: 'dispense-1',
        status: 'rejected',
        error_code: 'version_conflict',
      }),
    ).toMatchObject({
      status: 'rejected',
      errorCode: 'version_conflict',
      sourceLine: null,
      targets: [],
    })
  })

  it('requires exactly one reagent identity and one capacity dimension', () => {
    expect(() =>
      encodeReagentDraft({
        materialUuid: 'material-1',
        reagentInfoUuid: 'info-1',
        cas: '64-17-5',
        quantity: 1,
        quantityUnit: 'mL',
      }),
    ).toThrow('登记试剂必须且只能提供 reagentInfoUuid 或 cas 之一')

    expect(() =>
      encodeReagentDraft({
        materialUuid: 'material-1',
        quantity: 1,
        quantityUnit: 'mL',
      }),
    ).toThrow('登记试剂必须且只能提供 reagentInfoUuid 或 cas 之一')

    expect(() =>
      encodeReagentDraft({
        materialUuid: 'material-1',
        cas: '64-17-5',
        quantity: 1,
        quantityUnit: 'mL',
        containerCapacity: { maxVolumeUl: 1000, maxMassG: 1 },
      }),
    ).toThrow('容器装料上限必须且只能提供 maxVolumeUl 或 maxMassG 之一')

    expect(
      encodeReagentDraft({
        materialUuid: 'material-1',
        reagentInfoUuid: 'info-1',
        quantity: 500,
        quantityUnit: 'mL',
        concentrationValue: 95,
        concentrationUnit: '%',
        containerCapacity: { maxVolumeUl: 1000000 },
      }),
    ).toEqual({
      material_uuid: 'material-1',
      reagent_info_uuid: 'info-1',
      quantity: 500,
      quantity_unit: 'mL',
      concentration_value: 95,
      concentration_unit: '%',
      container_capacity: { max_volume_ul: 1000000 },
    })
  })

  it('sends only the keys an update explicitly provides', () => {
    expect(encodeReagentInfoPatch({ description: '联调更新' })).toEqual({ description: '联调更新' })
    expect(encodeReagentInfoPatch({ nameEn: null })).toEqual({ name_en: null })
    expect(encodeReagentInfoPatch({})).toEqual({})
    expect(encodeReagentPatch({ quantity: 400, quantityUnit: 'mL', expectedRevision: 2 })).toEqual({
      quantity: 400,
      quantity_unit: 'mL',
      expected_revision: 2,
    })
  })
})
