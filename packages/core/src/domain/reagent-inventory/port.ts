import type {
  InventoryInstance,
  InventoryLot,
  InventorySnapshot,
  Reagent,
  ReagentInfo,
  ReagentInfoPage,
  ReagentPage
} from './model'

export interface ReagentInventoryPort {
  listReagentInfos(input?: {
    readonly page?: number
    readonly pageSize?: number
    readonly name?: string
    readonly cas?: string
    readonly physicalState?: string
  }): Promise<ReagentInfoPage>

  getReagentInfo(reagentInfoUuid: string): Promise<ReagentInfo>

  listReagents(input?: {
    readonly page?: number
    readonly pageSize?: number
    readonly materialUuid?: string
    readonly reagentInfoUuid?: string
    readonly keyword?: string
    readonly cas?: string
    readonly barcode?: string
  }): Promise<ReagentPage>

  getReagent(reagentUuid: string): Promise<Reagent>

  listInventoryInstances(): Promise<readonly InventoryInstance[]>

  getInventoryInstance(instanceUuid: string): Promise<InventoryInstance>

  listInventoryLots(): Promise<readonly InventoryLot[]>

  getInventoryLot(lotId: string): Promise<InventoryLot>

  getInventorySnapshot(): Promise<InventorySnapshot>
}
