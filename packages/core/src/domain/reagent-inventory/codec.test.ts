import { describe, expect, it } from 'vitest'
import {
  decodeInventorySnapshot,
  decodeInventoryInstances,
  decodeReagent,
  decodeReagentInfo
} from './codec'

describe('reagent inventory codec', () => {
  it('keeps backend quantities and reservation dimensions unknown when omitted', () => {
    expect(decodeReagent({
      uuid: 'reagent-1',
      material_uuid: 'material-1',
      reagent_info_uuid: 'info-1',
      name: '乙腈',
      quantity: 10,
      quantity_unit: 'mL',
      meta_data: {},
      revision: 3
    })).toMatchObject({
      reagentUuid: 'reagent-1',
      quantity: 10,
      reservedQuantity: null,
      status: 'available'
    })
  })

  it('maps the reagent information identity without inventing aliases or metadata', () => {
    expect(decodeReagentInfo({
      uuid: 'info-1',
      name: '乙腈',
      aliases: ['acetonitrile'],
      physical_state: 'liquid'
    })).toMatchObject({
      reagentInfoUuid: 'info-1',
      aliases: ['acetonitrile'],
      physicalState: 'liquid',
      metadata: {}
    })
  })

  it('maps the complete edge snapshot and derives only observable lot status', () => {
    const snapshot = decodeInventorySnapshot({
      snapshot_sequence: 8,
      templates: [{ template_id: 'reagent-naoh', name: 'NaOH', category: 'reagent', spec_json: '{}', version: 1 }],
      lots: [
        { lot_id: 'lot-empty', template_id: 'reagent-naoh', quantity_total: 0, quantity_available: 0, quantity_reserved: 0, quarantined: 0, version: 1 },
        { lot_id: 'lot-reserved', template_id: 'reagent-naoh', quantity_total: 10, quantity_available: 0, quantity_reserved: 10, quarantined: 0, version: 1 },
        { lot_id: 'lot-quarantined', template_id: 'reagent-naoh', quantity_total: 10, quantity_available: 10, quantity_reserved: 0, quarantined: 1, version: 1 }
      ],
      instances: [{ edge_uuid: 'instance-1', template_id: 'reagent-naoh', status: 'available', version: 1, relation: { parent_uuid: 'deck-1', slot_id: 'A1', child_uuid: 'instance-1', version: 1 } }],
      relations: [{ parent_uuid: 'deck-1', slot_id: 'A1', child_uuid: 'instance-1', version: 1 }],
      contents: [{ instance_uuid: 'instance-1', state_json: '{}', version: 1 }],
      reservations: [{ reservation_id: 'reservation-1', workflow_id: 'workflow-1', node_id: 'node-1', attempt: 0, status: 'active', amounts_json: '{}', created_at: 10, version: 1 }]
    })

    expect(snapshot).toMatchObject({
      snapshotSequence: 8,
      lots: [
        { lotId: 'lot-empty', status: 'empty' },
        { lotId: 'lot-reserved', status: 'reserved' },
        { lotId: 'lot-quarantined', status: 'quarantined' }
      ],
      instances: [{ instanceUuid: 'instance-1', relation: { slotId: 'A1' } }],
      reservations: [{ reservationId: 'reservation-1', attempt: 0 }]
    })
  })

  it('accepts the direct edge instance list response and rejects string quantities', () => {
    expect(decodeInventoryInstances({ instances: [{ edge_uuid: 'instance-1', template_id: 'vial', status: 'available' }] }))
      .toMatchObject([{ instanceUuid: 'instance-1' }])
    expect(() => decodeReagent({
      uuid: 'reagent-1', material_uuid: 'material-1', reagent_info_uuid: 'info-1', name: '乙腈',
      quantity: '10', meta_data: {}, revision: 1
    })).toThrow('reagent.quantity must be a finite number')
  })
})
