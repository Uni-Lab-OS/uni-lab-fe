export type ReagentInventoryErrorCode =
  | 'INVALID_REAGENT_INVENTORY_RESPONSE'
  | 'OS_REQUEST_REJECTED'
  | 'UNSUPPORTED_INVENTORY_ROUTE'

export class ReagentInventoryError extends Error {
  constructor(
    readonly code: ReagentInventoryErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ReagentInventoryError'
  }
}
