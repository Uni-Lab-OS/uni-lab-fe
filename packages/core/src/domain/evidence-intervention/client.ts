import type { RequestTransport } from '../../transport/request'
import type { EvidenceInterventionRecord, InterventionListResponse } from './api'
import { decodeIntervention, decodeInterventionList } from './codec'
import type { EvidenceInterventionPort } from './port'

export class EvidenceInterventionClient implements EvidenceInterventionPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1'
  ) {}

  async listInterventions(input: {
    readonly status?: string
    readonly limit?: number
  } = {}) {
    const params = new URLSearchParams({
      status: input.status ?? 'open',
      limit: String(input.limit ?? 100)
    })
    const response = await this.transport.request<InterventionListResponse | readonly EvidenceInterventionRecord[]>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-interventions?${params.toString()}`
    })
    return decodeInterventionList(response.data)
  }

  async getIntervention(interventionUuid: string) {
    const response = await this.transport.request<EvidenceInterventionRecord>({
      method: 'GET',
      url: `${this.apiPrefix}/workflow-interventions/${encodeURIComponent(interventionUuid)}`
    })
    return decodeIntervention(response.data)
  }
}
