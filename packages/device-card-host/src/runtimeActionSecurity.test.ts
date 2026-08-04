import { describe, expect, it } from 'vitest'

import {
  requiresDeviceCardActionConfirmation,
  validateDeviceCardActionParams
} from './runtimeActionSecurity'

describe('device card Host Action security', () => {
  it('validates card parameters against the authoritative field-map schema', () => {
    const schema = {
      duration_seconds: {
        type: 'integer',
        required: true,
        minimum: 1,
        maximum: 30
      },
      options: {
        type: 'object',
        additionalProperties: false,
        properties: {
          safe: { type: 'boolean' }
        },
        required: ['safe']
      }
    }

    expect(validateDeviceCardActionParams(schema, {
      duration_seconds: 3,
      options: { safe: true }
    })).toEqual({ valid: true, errors: [] })
    expect(validateDeviceCardActionParams(schema, {
      duration_seconds: 0,
      options: { safe: 'yes' },
      smuggled: true
    })).toMatchObject({ valid: false })
  })

  it('accepts a full object JSON Schema and fails closed for invalid schemas', () => {
    expect(validateDeviceCardActionParams({
      type: 'object',
      additionalProperties: false,
      properties: { mode: { enum: ['safe'] } },
      required: ['mode']
    }, { mode: 'safe' })).toEqual({ valid: true, errors: [] })
    expect(validateDeviceCardActionParams({
      type: 'not-a-json-schema-type'
    }, {})).toMatchObject({ valid: false })
  })

  it('requires Host confirmation for every non-normal Edge risk level', () => {
    expect(requiresDeviceCardActionConfirmation('normal')).toBe(false)
    expect(requiresDeviceCardActionConfirmation('dangerous')).toBe(true)
    expect(requiresDeviceCardActionConfirmation('emergency')).toBe(true)
  })
})
