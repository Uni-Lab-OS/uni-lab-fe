interface ReagentIdentity {
  readonly source: 'os' | 'fixture'
  readonly reagentUuid: string
  readonly materialUuid: string
  readonly reagentInfoUuid: string
  readonly name: string
  readonly nameEn: string | null
  readonly cas: string | null
  readonly molecularFormula: string | null
  readonly physicalState: string | null
  readonly quantity: number | null
  readonly quantityUnit: string | null
  readonly reservedQuantity: number | null
  readonly concentrationValue: number | null
  readonly concentrationUnit: string | null
  readonly densityGPerMl: number | null
  readonly revision: number | null
  readonly containerBarcode: string | null
  readonly containerName: string | null
  readonly description: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface Reagent extends ReagentIdentity {
  readonly kind: 'reagent'
  readonly status: string
}

export interface ReagentInfo {
  readonly kind: 'reagent_info'
  readonly source: 'os' | 'fixture'
  readonly reagentInfoUuid: string
  readonly name: string
  readonly nameEn: string | null
  readonly aliases: readonly string[]
  readonly cas: string | null
  readonly molecularFormula: string | null
  readonly smiles: string | null
  readonly inchiKey: string | null
  readonly molecularWeight: number | null
  readonly densityGPerMl: number | null
  readonly physicalState: string
  readonly description: string | null
  readonly metadata: Readonly<Record<string, unknown>>
  readonly createdAt: string | null
  readonly updatedAt: string | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ReagentPage {
  readonly items: readonly Reagent[]
  readonly total: number | null
  readonly page: number | null
  readonly pageSize: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface ReagentInfoPage {
  readonly items: readonly ReagentInfo[]
  readonly total: number | null
  readonly page: number | null
  readonly pageSize: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryTemplate {
  readonly templateId: string
  readonly name: string
  readonly category: string
  readonly specJson: string | null
  readonly version: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryLot {
  readonly lotId: string
  readonly templateId: string
  readonly batchNo: string | null
  readonly unit: string | null
  readonly totalQuantity: number | null
  readonly availableQuantity: number | null
  readonly reservedQuantity: number | null
  readonly expiry: string | null
  readonly quarantined: boolean | null
  readonly warehouseZoneId: string | null
  readonly createdAt: number | null
  readonly version: number | null
  readonly status: string
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryInstance {
  readonly instanceUuid: string
  readonly legacyCloudId: string | null
  readonly lotId: string | null
  readonly templateId: string
  readonly barcode: string | null
  readonly status: string
  readonly version: number | null
  readonly parentUuid: string | null
  readonly relation?: InventoryRelation | null
  readonly content?: InventoryContent | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryRelation {
  readonly parentUuid: string
  readonly slotId: string | null
  readonly childUuid: string
  readonly version: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryContent {
  readonly instanceUuid: string
  readonly stateJson: string | null
  readonly version: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventoryReservation {
  readonly reservationId: string
  readonly workflowId: string
  readonly nodeId: string | null
  readonly attempt: number | null
  readonly status: string
  readonly amountsJson: string | null
  readonly createdAt: number | null
  readonly version: number | null
  readonly raw: Readonly<Record<string, unknown>>
}

export interface InventorySnapshot {
  readonly kind: 'inventory_snapshot'
  readonly source: 'os' | 'fixture'
  readonly snapshotSequence: number | null
  readonly templates: readonly InventoryTemplate[]
  readonly lots: readonly InventoryLot[]
  readonly instances: readonly InventoryInstance[]
  readonly relations: readonly InventoryRelation[]
  readonly contents: readonly InventoryContent[]
  readonly reservations: readonly InventoryReservation[]
  readonly raw: Readonly<Record<string, unknown>>
}
