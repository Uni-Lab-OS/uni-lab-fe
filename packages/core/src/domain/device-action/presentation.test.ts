import { describe, expect, it } from 'vitest'
import { deviceDispatchStatus, deviceOccupancyStatus } from './presentation'

describe('device occupancy presentation', () => {
  it('prefers active action or execution occupancy', () => {
    expect(
      deviceOccupancyStatus({
        actions: [
          {
            actionName: 'aspirate',
            actionRef: 'aspirate',
            label: '吸液',
            actionType: 'aspirate',
            actionDefinitionUuid: null,
            isBusy: true,
            busyStatusKnown: true,
            currentJobUuid: 'job-1',
            raw: {}
          }
        ],
        executionOccupancies: []
      })
    ).toBe('occupied')

    expect(
      deviceOccupancyStatus({
        actions: [],
        executionOccupancies: [
          {
            leaseUuid: null,
            workflowTaskUuid: 'task-1',
            workflowNodeJobUuid: 'job-1',
            state: 'running',
            actionName: 'aspirate',
            acquiredAt: null,
            raw: {}
          }
        ]
      })
    ).toBe('occupied')
  })

  it('returns idle only when every action status is known', () => {
    expect(
      deviceOccupancyStatus({
        actions: [
          {
            actionName: 'aspirate',
            actionRef: 'aspirate',
            label: '吸液',
            actionType: 'aspirate',
            actionDefinitionUuid: null,
            isBusy: false,
            busyStatusKnown: true,
            currentJobUuid: null,
            raw: {}
          }
        ],
        executionOccupancies: []
      })
    ).toBe('idle')

    expect(
      deviceOccupancyStatus({
        actions: [
          {
            actionName: 'aspirate',
            actionRef: 'aspirate',
            label: '吸液',
            actionType: 'aspirate',
            actionDefinitionUuid: null,
            isBusy: null,
            busyStatusKnown: false,
            currentJobUuid: null,
            raw: {}
          }
        ],
        executionOccupancies: null
      })
    ).toBe('unknown')
  })
})

describe('device dispatch presentation', () => {
  it('fails closed when online or dispatchable facts are unknown', () => {
    expect(deviceDispatchStatus({ online: true, dispatchable: true })).toBe('available')
    expect(deviceDispatchStatus({ online: false, dispatchable: false })).toBe('offline')
    expect(deviceDispatchStatus({ online: true, dispatchable: false })).toBe('blocked')
    expect(deviceDispatchStatus({ online: true, dispatchable: null })).toBe('unknown')
    expect(deviceDispatchStatus({ online: null, dispatchable: true })).toBe('unknown')
  })
})
