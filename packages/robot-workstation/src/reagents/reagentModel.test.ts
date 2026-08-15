import { describe, expect, it } from 'vitest'

import { REAGENT_LEDGER } from '../fixtures'
import { applyReagentRecord, calculateAvailableQuantity, validateRegistration } from './reagentModel'

describe('reagentModel', () => {
  it('never returns a negative available quantity', () => {
    expect(
      calculateAvailableQuantity({
        remainingQuantity: 10,
        reservedQuantity: 12,
      }),
    ).toBe(0)
    expect(
      calculateAvailableQuantity({
        remainingQuantity: 12.5,
        reservedQuantity: 2.25,
      }),
    ).toBe(10.25)
  })

  it('rejects expiry before registration and non-positive quantity', () => {
    expect(
      validateRegistration({
        reagentId: 'r1',
        densityValue: 1,
        densityUnit: 'g/mL',
        densityCondition: '20℃',
        supplier: '供应商',
        registeredOn: '2026-08-12',
        expiresOn: '2026-08-11',
        quantity: 1,
        unit: 'mL',
        siteId: 'S1',
        custom: [],
      }),
    ).toBe('有效期不能早于登记日期')
    expect(
      validateRegistration({
        reagentId: 'r1',
        densityValue: 1,
        densityUnit: 'g/mL',
        densityCondition: '20℃',
        supplier: '供应商',
        registeredOn: '2026-08-12',
        expiresOn: '2026-08-13',
        quantity: 0,
        unit: 'mL',
        siteId: 'S1',
        custom: [],
      }),
    ).toBe('初始数量必须为正数')
  })

  it('does not mutate quantity for execution_unknown or untrusted receipts', () => {
    const row = REAGENT_LEDGER[0]
    const next = applyReagentRecord(row, {
      id: 'unknown',
      taskId: 'T1',
      action: '设备执行结果未知',
      quantityDelta: -100,
      fromSite: row.siteId,
      toSite: 'S2',
      result: 'execution_unknown',
      trusted: false,
      occurredAt: '2026-08-12',
      traceId: 'trace-unknown',
    })

    expect(next.remainingQuantity).toBe(row.remainingQuantity)
    expect(next.siteId).toBe(row.siteId)
    expect(next.reservedQuantity).toBe(row.reservedQuantity)
    expect(next.records.at(-1)?.result).toBe('execution_unknown')
  })
})
