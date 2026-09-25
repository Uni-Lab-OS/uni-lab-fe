export type ReagentInventoryRecord = Readonly<Record<string, unknown>>

export interface ReagentInfoListResponse extends ReagentInventoryRecord {
  readonly items?: readonly ReagentInventoryRecord[]
  readonly data?: readonly ReagentInventoryRecord[]
}

export interface ReagentListResponse extends ReagentInventoryRecord {
  readonly items?: readonly ReagentInventoryRecord[]
  readonly data?: readonly ReagentInventoryRecord[]
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
