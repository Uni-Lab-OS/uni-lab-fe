export type EvidenceInterventionRecord = Readonly<Record<string, unknown>>

export interface InterventionListResponse extends EvidenceInterventionRecord {
  readonly items?: readonly EvidenceInterventionRecord[]
}
