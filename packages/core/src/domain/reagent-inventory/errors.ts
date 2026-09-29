export type ReagentInventoryErrorCode =
  | 'INVALID_REAGENT_INVENTORY_RESPONSE'
  | 'INVALID_REAGENT_WRITE_INPUT'
  | 'OS_REQUEST_REJECTED'
  | 'UNSUPPORTED_INVENTORY_ROUTE'

export interface ReagentInventoryErrorOptions {
  /** OS 业务错误码；批量导入等场景据此区分校验失败与写入冲突。 */
  readonly osCode?: number | string
  /** OS 返回的结构化明细，例如批量导入的逐行错误，原样透出给调用方。 */
  readonly details?: Readonly<Record<string, unknown>>
}

export class ReagentInventoryError extends Error {
  readonly osCode?: number | string
  readonly details?: Readonly<Record<string, unknown>>

  constructor(
    readonly code: ReagentInventoryErrorCode,
    message: string,
    options: ReagentInventoryErrorOptions = {}
  ) {
    super(message)
    this.name = 'ReagentInventoryError'
    this.osCode = options.osCode
    this.details = options.details
  }
}
