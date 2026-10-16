import { RuntimeReadinessClient } from '../domain/runtime-readiness/readiness'
import { createFetchTransport, type FetchTransportOptions } from '../adapters/fetch'
import { WorkflowDefinitionClient } from '../domain/workflow-definition/client'
import { RunPreparationClient } from '../domain/run-preparation/client'
import { WorkflowExecutionReadClient } from '../domain/workflow-execution-read/client'
import { WorkflowExecutionControlClient } from '../domain/workflow-execution-control/client'
import type { WorkflowRuntimeEventsPort } from '../domain/workflow-runtime-events/port'
import { WorkflowExecutionRecoveryClient } from '../domain/workflow-execution-recovery/client'
import { DeviceActionClient } from '../domain/device-action/client'
import type { DeviceActionPort, DeviceActionPresentationPort } from '../domain/device-action/port'
import { MaterialSiteClient } from '../domain/material-site/client'
import type { MaterialSitePort } from '../domain/material-site/port'
import { ReagentInventoryClient } from '../domain/reagent-inventory/client'
import type { ReagentInventoryPort } from '../domain/reagent-inventory/port'
import { EvidenceInterventionClient } from '../domain/evidence-intervention/client'
import type { EvidenceInterventionPort } from '../domain/evidence-intervention/port'
import { WorkflowManualConfirmationClient } from '../domain/workflow-manual-confirmation/client'
import type { WorkflowManualConfirmationPort } from '../domain/workflow-manual-confirmation/port'
import { WorkflowHumanInteractionClient } from '../domain/workflow-human-interaction/client'
import type { WorkflowHumanInteractionPort } from '../domain/workflow-human-interaction/port'
import { SchedulerTimePlanClient } from '../domain/scheduler-time-plan/client'
import type { SchedulerTimePlanPort } from '../domain/scheduler-time-plan/port'
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
  readonly deviceActionPresentations: DeviceActionPresentationPort
  readonly runtimeReadiness: RuntimeReadinessClient
  readonly materialSite: MaterialSitePort
  readonly reagentInventory: ReagentInventoryPort
  readonly evidenceIntervention: EvidenceInterventionPort
  readonly manualConfirmation: WorkflowManualConfirmationPort
  readonly humanInteractions: WorkflowHumanInteractionPort
  readonly schedulerTimePlan: SchedulerTimePlanPort
  readonly runPreparation: ReturnType<typeof createRunPreparationScenario>
  readonly workflowDebugging: ReturnType<typeof createWorkflowDebuggingScenario>
  readonly deviceActionDebugging: ReturnType<typeof createDeviceActionDebuggingScenario>
  readonly laboratoryOperations: ReturnType<typeof createLaboratoryOperationsScenario>
}

export interface BackendCoreIntegrations {
  readonly runtimeEvents?: WorkflowRuntimeEventsPort
  /** 后端根地址；OS 返回的 /api/... 资源（如人工复核图片）据此解析为可加载地址。 */
  readonly assetBaseUrl?: string
}

export function createBackendCore(
  options: FetchTransportOptions,
  integrations: BackendCoreIntegrations = {},
): BackendCore {
  return createBackendCoreFromTransport(createFetchTransport(options), {
    assetBaseUrl: options.baseUrl,
    ...integrations,
  })
}

export function createBackendCoreFromTransport(
  transport: RequestTransport,
  integrations: BackendCoreIntegrations = {},
): BackendCore {
  const workflowDefinitions = new WorkflowDefinitionClient(transport)
  const runPreparationPort = new RunPreparationClient(transport)
  const executionRead = new WorkflowExecutionReadClient(transport)
  const executionControl = new WorkflowExecutionControlClient(transport)
  const executionRecovery = new WorkflowExecutionRecoveryClient(executionRead, transport)
  const deviceActions = new DeviceActionClient(transport, executionRead)
  const materialSite = new MaterialSiteClient(transport)
  const reagentInventory = new ReagentInventoryClient(transport)
  const evidenceIntervention = new EvidenceInterventionClient(transport)
  const manualConfirmation = new WorkflowManualConfirmationClient(transport)
  const humanInteractions = new WorkflowHumanInteractionClient(
    transport,
    integrations.assetBaseUrl ?? null,
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
    deviceActionPresentations: deviceActions,
    runtimeReadiness: new RuntimeReadinessClient(transport),
    materialSite,
    reagentInventory,
    evidenceIntervention,
    manualConfirmation,
    humanInteractions,
    schedulerTimePlan: new SchedulerTimePlanClient(transport),
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
