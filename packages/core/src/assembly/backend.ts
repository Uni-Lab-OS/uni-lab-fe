import { createFetchTransport, type FetchTransportOptions } from '../adapters/fetch'
import { WorkflowDefinitionClient } from '../domain/workflow-definition/client'
import { RunPreparationClient } from '../domain/run-preparation/client'
import { WorkflowExecutionReadClient } from '../domain/workflow-execution-read/client'
import { DeviceActionClient } from '../domain/device-action/client'
import type { DeviceActionPort } from '../domain/device-action/port'
import { MaterialSiteClient } from '../domain/material-site/client'
import type { MaterialSitePort } from '../domain/material-site/port'
import { ReagentInventoryClient } from '../domain/reagent-inventory/client'
import type { ReagentInventoryPort } from '../domain/reagent-inventory/port'
import { EvidenceInterventionClient } from '../domain/evidence-intervention/client'
import type { EvidenceInterventionPort } from '../domain/evidence-intervention/port'
import type { RequestTransport } from '../transport/request'
import { createRunPreparationScenario } from '../scenarios/run-preparation/scenario'
import { createWorkflowDebuggingScenario } from '../scenarios/workflow-debugging/scenario'
import { createDeviceActionDebuggingScenario } from '../scenarios/device-action-debugging/scenario'
import { createLaboratoryOperationsScenario } from '../scenarios/laboratory-operations/scenario'

export interface BackendCore {
  readonly transport: RequestTransport
  readonly workflowDefinitions: WorkflowDefinitionClient
  readonly runPreparationPort: RunPreparationClient
  readonly executionRead: WorkflowExecutionReadClient
  readonly deviceActions: DeviceActionPort
  readonly materialSite: MaterialSitePort
  readonly reagentInventory: ReagentInventoryPort
  readonly evidenceIntervention: EvidenceInterventionPort
  readonly runPreparation: ReturnType<typeof createRunPreparationScenario>
  readonly workflowDebugging: ReturnType<typeof createWorkflowDebuggingScenario>
  readonly deviceActionDebugging: ReturnType<typeof createDeviceActionDebuggingScenario>
  readonly laboratoryOperations: ReturnType<typeof createLaboratoryOperationsScenario>
}

export function createBackendCore(options: FetchTransportOptions): BackendCore {
  return createBackendCoreFromTransport(createFetchTransport(options))
}

export function createBackendCoreFromTransport(
  transport: RequestTransport
): BackendCore {
  const workflowDefinitions = new WorkflowDefinitionClient(transport)
  const runPreparationPort = new RunPreparationClient(transport)
  const executionRead = new WorkflowExecutionReadClient(transport)
  const deviceActions = new DeviceActionClient(transport, executionRead)
  const materialSite = new MaterialSiteClient(transport)
  const reagentInventory = new ReagentInventoryClient(transport)
  const evidenceIntervention = new EvidenceInterventionClient(transport)
  return {
    transport,
    workflowDefinitions,
    runPreparationPort,
    executionRead,
    deviceActions,
    materialSite,
    reagentInventory,
    evidenceIntervention,
    runPreparation: createRunPreparationScenario(
      workflowDefinitions,
      runPreparationPort,
      { deviceActions, materialSite, reagentInventory }
    ),
    workflowDebugging: createWorkflowDebuggingScenario(executionRead, workflowDefinitions),
    deviceActionDebugging: createDeviceActionDebuggingScenario(deviceActions, executionRead),
    laboratoryOperations: createLaboratoryOperationsScenario(
      executionRead,
      deviceActions,
      evidenceIntervention
    )
  }
}
