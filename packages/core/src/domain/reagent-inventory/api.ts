export type ReagentInventoryRecord = Readonly<Record<string, unknown>>

export interface ReagentInfoListResponse extends ReagentInventoryRecord {
  readonly items?: readonly ReagentInventoryRecord[]
  readonly data?: readonly ReagentInventoryRecord[]
}

export interface ReagentListResponse extends ReagentInventoryRecord {
  readonly items?: readonly ReagentInventoryRecord[]
  readonly data?: readonly ReagentInventoryRecord[]
}

export interface ReagentHistoryListResponse extends ReagentInventoryRecord {
  readonly items?: readonly ReagentInventoryRecord[]
  readonly page?: number
  readonly page_size?: number
  readonly has_more?: boolean
}

export interface ReagentBatchResponse extends ReagentInventoryRecord {
  readonly total?: number
  readonly created?: number
  readonly failed?: number
  readonly atomic?: boolean
  readonly items?: readonly ReagentInventoryRecord[]
  readonly errors?: readonly ReagentInventoryRecord[]
}

/**
 * 库存命令响应不使用 `{code,data}` 信封，而是直接返回命令结果；版本冲突时
 * HTTP 状态码为 409，`error_code` 保留具体原因。
 */
export interface InventoryCommandResponse extends ReagentInventoryRecord {
  readonly command_id?: string
  readonly status?: string
  readonly error_code?: string
  readonly error_message?: string
  readonly result?: ReagentInventoryRecord
}

export interface EdgeInstanceListResponse extends ReagentInventoryRecord {
  readonly instances?: readonly ReagentInventoryRecord[]
}

export interface EdgeLotListResponse extends ReagentInventoryRecord {
  readonly lots?: readonly ReagentInventoryRecord[]
}

export interface EdgeSnapshotResponse extends ReagentInventoryRecord {
  readonly templates?: readonly ReagentInventoryRecord[]
  readonly lots?: readonly ReagentInventoryRecord[]
  readonly instances?: readonly ReagentInventoryRecord[]
  readonly relations?: readonly ReagentInventoryRecord[]
  readonly contents?: readonly ReagentInventoryRecord[]
  readonly reservations?: readonly ReagentInventoryRecord[]
}
