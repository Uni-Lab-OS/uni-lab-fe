import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'

import type {
  DeviceCardActionRiskLevel
} from '@unilab/device-card-sdk'

export interface DeviceCardActionValidationResult {
  valid: boolean
  errors: string[]
}

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
  validateFormats: false
})

export function validateDeviceCardActionParams(
  authoritativeSchema: Record<string, unknown>,
  params: Record<string, unknown>
): DeviceCardActionValidationResult {
  let validate: ValidateFunction
  try {
    validate = ajv.compile(normalizeActionInputSchema(authoritativeSchema))
  } catch (error) {
    return {
      valid: false,
      errors: [
        `OS Action JSON Schema 无效：${
          error instanceof Error ? error.message : String(error)
        }`
      ]
    }
  }
  if (validate(params)) return { valid: true, errors: [] }
  return {
    valid: false,
    errors: (validate.errors ?? []).map(formatValidationError)
  }
}

export function requiresDeviceCardActionConfirmation(
  riskLevel: DeviceCardActionRiskLevel
): boolean {
  return riskLevel === 'dangerous' || riskLevel === 'emergency'
}

function normalizeActionInputSchema(
  value: Record<string, unknown>
): Record<string, unknown> {
  if (
    value.type === 'object' ||
    Object.prototype.hasOwnProperty.call(value, 'properties') ||
    Object.prototype.hasOwnProperty.call(value, '$schema')
  ) return structuredClone(value)

  const required: string[] = []
  const properties = Object.fromEntries(
    Object.entries(value).map(([name, rawDefinition]) => {
      if (!isRecord(rawDefinition)) return [name, rawDefinition]
      const definition = structuredClone(rawDefinition)
      if (definition.required === true) required.push(name)
      if (typeof definition.required === 'boolean') delete definition.required
      return [name, definition]
    })
  )
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {})
  }
}

function formatValidationError(error: ErrorObject): string {
  return `${error.instancePath || '/'} ${error.message ?? error.keyword}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
