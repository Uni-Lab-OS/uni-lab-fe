import type {
  CompoundLookup,
  InventoryInstance,
  InventoryLot,
  InventorySnapshot,
  Reagent,
  ReagentBatchInput,
  ReagentBatchResult,
  ReagentDispenseCommand,
  ReagentDispenseResult,
  ReagentDraft,
  ReagentHistoryEntry,
  ReagentHistoryPage,
  ReagentImportInput,
  ReagentInfo,
  ReagentInfoBatchResult,
  ReagentInfoDraft,
  ReagentInfoPage,
  ReagentInfoPatch,
  ReagentPage,
  ReagentPatch,
  ReagentStructure3d
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

  createReagentInfo(draft: ReagentInfoDraft): Promise<ReagentInfo>

  updateReagentInfo(
    reagentInfoUuid: string,
    patch: ReagentInfoPatch
  ): Promise<ReagentInfo>

  /** 已被库存引用的身份不可删除，OS 会以业务错误拒绝。 */
  deleteReagentInfo(reagentInfoUuid: string): Promise<void>

  createReagentInfoBatch(input: ReagentBatchInput): Promise<ReagentInfoBatchResult>

  importReagentInfos(input: ReagentImportInput): Promise<ReagentInfoBatchResult>

  getReagentInfoStructure3d(reagentInfoUuid: string): Promise<ReagentStructure3d>

  /** 按 CAS 取化合物候选值，用于录入前预填，不写入任何身份。 */
  lookupCompound(cas: string): Promise<CompoundLookup>

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

  createReagent(draft: ReagentDraft): Promise<Reagent>

  updateReagent(reagentUuid: string, patch: ReagentPatch): Promise<Reagent>

  /** 存在活动工作流预留的试剂不可删除，OS 会以业务错误拒绝。 */
  deleteReagent(reagentUuid: string): Promise<void>

  createReagentBatch(input: ReagentBatchInput): Promise<ReagentBatchResult>

  importReagents(input: ReagentImportInput): Promise<ReagentBatchResult>

  getReagentHistory(historyUuid: string): Promise<ReagentHistoryEntry>

  listReagentHistory(
    materialUuid: string,
    input?: { readonly page?: number; readonly pageSize?: number }
  ): Promise<ReagentHistoryPage>

  /**
   * 试剂分装。走库存命令入口并按 `commandId` 幂等；HTTP 接受不等于分装成功，
   * 终态由返回的 `status` 与 `errorCode` 决定。
   */
  dispenseReagent(command: ReagentDispenseCommand): Promise<ReagentDispenseResult>

  listInventoryInstances(): Promise<readonly InventoryInstance[]>

  getInventoryInstance(instanceUuid: string): Promise<InventoryInstance>

  listInventoryLots(): Promise<readonly InventoryLot[]>

  getInventoryLot(lotId: string): Promise<InventoryLot>

  getInventorySnapshot(): Promise<InventorySnapshot>
}
