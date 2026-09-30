export type DeviceActionErrorCode =
  | 'INVALID_ACTION_DEFINITION'
  | 'ACTION_DEFINITION_NOT_FOUND'
  | 'UNSUPPORTED_ACTION_CONTRACT'
  | 'INVALID_DEVICE_CATALOG'
  | 'INVALID_ACTION_RUN_RESPONSE'
  | 'OS_REQUEST_REJECTED'

export class DeviceActionError extends Error {
  constructor(
    readonly code: DeviceActionErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'DeviceActionError'
  }
}
