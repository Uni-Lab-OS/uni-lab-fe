import { describe, expect, it } from 'vitest'

import {
  deviceCardActionContractSignature,
  isDeviceCardLiveBinding
} from './runtimeBinding'

describe('device card Live binding', () => {
  it('defaults to Mock even when a compatible real device exists', () => {
    expect(isDeviceCardLiveBinding(
      null,
      'installed:card@1',
      'D1ADevice1'
    )).toBe(false)
  })

  it('requires an explicit binding for the exact preview and device', () => {
    const binding = {
      previewId: 'installed:card@1',
      deviceId: 'D1ADevice1'
    }
    expect(isDeviceCardLiveBinding(
      binding,
      'installed:card@1',
      'D1ADevice1'
    )).toBe(true)
    expect(isDeviceCardLiveBinding(
      binding,
      'workspace:new-source-hash',
      'D1ADevice1'
    )).toBe(false)
    expect(isDeviceCardLiveBinding(
      binding,
      'installed:card@1',
      'OtherDevice'
    )).toBe(false)
  })

  it('does not reload a card when only Action busy presentation changes', () => {
    const action = {
      actionName: 'test_hold',
      actionRef: 'D1ADevice1.test_hold',
      label: '单节点运行',
      typeName: 'UniLabJsonCommand',
      inputSchema: { duration_seconds: { type: 'integer' } },
      outputSchema: {},
      riskLevel: 'normal' as const,
      isBusy: false
    }
    expect(deviceCardActionContractSignature([{ ...action, isBusy: true }]))
      .toBe(deviceCardActionContractSignature([action]))
  })
})
