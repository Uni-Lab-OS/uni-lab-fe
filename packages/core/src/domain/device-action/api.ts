export type DeviceActionRecord = Readonly<Record<string, unknown>>

export interface ActionDefinitionListResponse extends DeviceActionRecord {
  readonly items?: readonly DeviceActionRecord[]
  readonly data?: readonly DeviceActionRecord[]
}

export interface ActionDefinitionDetailResponse extends DeviceActionRecord {
  readonly template?: DeviceActionRecord
  readonly handles?: readonly DeviceActionRecord[]
}

export interface DeviceListResponse extends DeviceActionRecord {
  readonly items?: readonly DeviceActionRecord[]
  readonly devices?: readonly DeviceActionRecord[]
  readonly data?: readonly DeviceActionRecord[]
}

export interface DeviceActionRunResponse extends DeviceActionRecord {
  readonly created?: boolean
  readonly task?: DeviceActionRecord
  readonly job?: DeviceActionRecord
}
