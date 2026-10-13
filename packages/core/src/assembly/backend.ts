import { createFetchTransport, type FetchTransportOptions } from '../adapters/fetch'
import { WorkflowDefinitionClient } from '../domain/workflow-definition/client'
import { RunPreparationClient } from '../domain/run-preparation/client'
import { WorkflowExecutionReadClient } from '../domain/workflow-execution-read/client'
import { WorkflowExecutionControlClient } from '../domain/workflow-execution-control/client'
import type { WorkflowRuntimeEventsPort } from '../domain/workflow-runtime-events/port'
import { WorkflowExecutionRecoveryClient } from '../domain/workflow-execution-recovery/client'
import { DeviceActionClient } from '../domain/device-action/client'
import type { DeviceActionPort } from '../domain/device-action/port'
import { MaterialSiteClient } from '../domain/material-site/client'
import type { MaterialSitePort } from '../domain/material-site/port'
import { ReagentInventoryClient } from '../domain/reagent-inventory/client'
import type { ReagentInventoryPort } from '../domain/reagent-inventory/port'
import { EvidenceInterventionClient } from '../domain/evidence-intervention/client'
import type { EvidenceInterventionPort } from '../domain/evidence-intervention/port'
import { WorkflowManualConfirmationClient } from '../domain/workflow-manual-confirmation/client'
import type { WorkflowManualConfirmationPort } from '../domain/workflow-manual-confirmation/port'
import { StationErrorHandlingClient } from '../domain/station-error-handling/client'
import type { StationErrorHandlingPort } from '../domain/station-error-handling/port'
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
  readonly executionControl: WorkflowExecutionControlClient
  readonly executionRecovery: WorkflowExecutionRecoveryClient
  readonly workflowRuntimeEvents?: WorkflowRuntimeEventsPort
  readonly deviceActions: DeviceActionPort
  readonly materialSite: MaterialSitePort
  readonly reagentInventory: ReagentInventoryPort
  readonly evidenceIntervention: EvidenceInterventionPort
  readonly manualConfirmation: WorkflowManualConfirmationPort
  readonly stationErrorHandling: StationErrorHandlingPort
  readonly runPreparation: ReturnType<typeof createRunPreparationScenario>
  readonly workflowDebugging: ReturnType<typeof createWorkflowDebuggingScenario>
  readonly deviceActionDebugging: ReturnType<typeof createDeviceActionDebuggingScenario>
  readonly laboratoryOperations: ReturnType<typeof createLaboratoryOperationsScenario>
}

export interface BackendCoreIntegrations {
  readonly runtimeEvents?: WorkflowRuntimeEventsPort
  /** 工站作用域是部署事实，由 profile 决定，不是前端业务常量。 */
  readonly stationId?: string
}

export function createBackendCore(
  options: FetchTransportOptions,
  integrations: BackendCoreIntegrations = {},
): BackendCore {
  return createBackendCoreFromTransport(createFetchTransport(options), integrations)
}

export function createBackendCoreFromTransport(
  transport: RequestTransport,
  integrations: BackendCoreIntegrations = {},
): BackendCore {
  const workflowDefinitions = new WorkflowDefinitionClient(transport)
  const runPreparationPort = new RunPreparationClient(transport)
  const executionRead = new WorkflowExecutionReadClient(transport)
  const executionControl = new WorkflowExecutionControlClient(transport)
  const executionRecovery = new WorkflowExecutionRecoveryClient(executionRead)
  const deviceActions = new DeviceActionClient(transport, executionRead)
  const materialSite = new MaterialSiteClient(transport)
  const reagentInventory = new ReagentInventoryClient(transport)
  const evidenceIntervention = new EvidenceInterventionClient(transport)
  const manualConfirmation = new WorkflowManualConfirmationClient(transport)
  // OS 目前 StationExecutionControl 的 station_id 恒为默认 "local"，还没有多工站支持；
  // 这里由 profile 提供部署事实，待 OS 支持多工站后不再是常量。
  const stationErrorHandling = new StationErrorHandlingClient(
    transport,
    integrations.stationId ?? 'local',
  )
  return {
    transport,
    workflowDefinitions,
    runPreparationPort,
    executionRead,
    executionControl,
    executionRecovery,
    workflowRuntimeEvents: integrations.runtimeEvents,
    deviceActions,
    materialSite,
    reagentInventory,
    evidenceIntervention,
    manualConfirmation,
    stationErrorHandling,
    runPreparation: createRunPreparationScenario(workflowDefinitions, runPreparationPort, {
      deviceActions,
      materialSite,
      reagentInventory,
    }),
    workflowDebugging: createWorkflowDebuggingScenario(
      executionRead,
      workflowDefinitions,
      executionControl,
      integrations.runtimeEvents,
    ),
    deviceActionDebugging: createDeviceActionDebuggingScenario(deviceActions, executionRead),
    laboratoryOperations: createLaboratoryOperationsScenario(
      executionRead,
      deviceActions,
      evidenceIntervention,
    ),
  }
}
