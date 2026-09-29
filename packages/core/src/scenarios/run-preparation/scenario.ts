import type { WorkflowDefinitionPort } from '../../domain/workflow-definition/port'
import type { RunPreparationPort } from '../../domain/run-preparation/port'
import type { DeviceActionPort } from '../../domain/device-action/port'
import { deviceDispatchStatus } from '../../domain/device-action/presentation'
import type { MaterialSitePort } from '../../domain/material-site/port'
import type { ReagentInventoryPort } from '../../domain/reagent-inventory/port'
import type {
  ResourceCandidate,
  ResourceCandidateIssue
} from '../../domain/run-preparation/model'
import type { RunPreparationState } from './state'
import {
  toRunPreparationViewModel,
  type RunPreparationViewModel
} from './view-model'

export interface RunPreparationScenario {
  load(workflowUuid: string, state: Omit<RunPreparationState, 'revision'>): Promise<RunPreparationViewModel>
  requestPreflight(state: RunPreparationState): ReturnType<RunPreparationPort['requestPreflight']>
  submitRun(state: RunPreparationState): ReturnType<RunPreparationPort['submitRun']>
  inspectNodeJob(
    viewModel: RunPreparationViewModel,
    jobUuid: string
  ): Promise<RunPreparationViewModel>
}

export interface RunPreparationCandidatePorts {
  readonly deviceActions?: Pick<DeviceActionPort, 'listDevices'>
  readonly materialSite?: Pick<MaterialSitePort, 'getGraph'>
  readonly reagentInventory?: Pick<ReagentInventoryPort, 'listInventoryInstances'>
}

export function createRunPreparationScenario(
  workflowDefinitions: WorkflowDefinitionPort,
  runPreparation: RunPreparationPort,
  candidatePorts: RunPreparationCandidatePorts = {}
): RunPreparationScenario {
  return {
    async load(workflowUuid, state) {
      const revision = await workflowDefinitions.getPublishedRevision(workflowUuid)
      const viewModel = toRunPreparationViewModel({ ...state, revision })
      const candidateResult = await loadCandidates(candidatePorts)
      return {
        ...viewModel,
        candidates: candidateResult.candidates,
        candidateIssues: candidateResult.issues
      }
    },
    requestPreflight: (state) => runPreparation.requestPreflight(
      state.revision.workflowUuid,
      state.configuration,
      state.binding
    ),
    submitRun: (state) => runPreparation.submitRun(
      state.revision.workflowUuid,
      state.configuration,
      state.binding
    ),
    async inspectNodeJob(viewModel, jobUuid) {
      const nodeJob = await runPreparation.getNodeJobDetail(jobUuid)
      return { ...viewModel, nodeJob }
    }
  }
}

async function loadCandidates(
  ports: RunPreparationCandidatePorts
): Promise<{
  readonly candidates: readonly ResourceCandidate[]
  readonly issues: readonly ResourceCandidateIssue[]
}> {
  const results = await Promise.allSettled([
    ports.deviceActions?.listDevices(),
    ports.materialSite?.getGraph(),
    ports.reagentInventory?.listInventoryInstances()
  ])
  const candidates: ResourceCandidate[] = []
  const issues: ResourceCandidateIssue[] = []

  const devices = settledValue(results[0], 'device', issues)
  if (devices) {
    for (const device of devices) {
      candidates.push({
        kind: 'resource_candidate',
        id: device.deviceUuid,
        resourceKind: 'device',
        label: device.label,
        status: deviceDispatchStatus(device),
        source: device.source,
        observedAt: null,
        metadata: device.raw
      })
    }
  }

  const graph = settledValue(results[1], 'material', issues)
  if (graph) {
    for (const node of graph.nodes) {
      const material = node.material
      candidates.push({
        kind: 'resource_candidate',
        id: material.materialUuid,
        resourceKind: 'material',
        label: material.name,
        status: null,
        source: material.source,
        observedAt: material.updatedAt,
        metadata: node.raw
      })
      for (const site of node.sites) {
        candidates.push({
          kind: 'resource_candidate',
          id: site.siteUuid,
          resourceKind: 'site',
          label: site.name || site.key,
          status: siteStatus(site.occupancy.known, site.occupancy.occupiedMaterialUuid),
          source: site.source,
          observedAt: null,
          metadata: site.raw
        })
      }
    }
  }

  const inventory = settledValue(results[2], 'inventory', issues)
  if (inventory) {
    for (const item of inventory) {
      candidates.push({
        kind: 'resource_candidate',
        id: item.instanceUuid,
        resourceKind: 'inventory',
        label: item.barcode ?? item.instanceUuid,
        status: item.status,
        source: 'os',
        observedAt: null,
        metadata: item.raw
      })
    }
  }

  return { candidates, issues }
}

function settledValue<T>(
  result: PromiseSettledResult<T | undefined>,
  resourceKind: ResourceCandidateIssue['resourceKind'],
  issues: ResourceCandidateIssue[]
): T | undefined {
  if (result.status === 'fulfilled') return result.value
  issues.push({
    kind: 'resource_candidate_issue',
    resourceKind,
    message: result.reason instanceof Error
      ? result.reason.message
      : '资源候选读取失败'
  })
  return undefined
}

function siteStatus(
  known: boolean,
  occupiedMaterialUuid: string | null
): ResourceCandidate['status'] {
  if (!known) return 'unknown'
  return occupiedMaterialUuid ? 'occupied' : 'available'
}
