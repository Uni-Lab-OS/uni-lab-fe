import { createFetchTransport, type FetchTransportOptions } from '../adapters/fetch'
import { WorkflowDefinitionClient } from '../domain/workflow-definition/client'
import { RunPreparationClient } from '../domain/run-preparation/client'
import { WorkflowExecutionReadClient } from '../domain/workflow-execution-read/client'
import { DeviceActionClient } from '../domain/device-action/client'
import type { DeviceActionPort } from '../domain/device-action/port'
import type { RequestTransport } from '../transport/request'
import { createRunPreparationScenario } from '../scenarios/run-preparation/scenario'

export interface BackendCore {
  readonly transport: RequestTransport
  readonly workflowDefinitions: WorkflowDefinitionClient
  readonly runPreparationPort: RunPreparationClient
  readonly executionRead: WorkflowExecutionReadClient
  readonly deviceActions: DeviceActionPort
  readonly runPreparation: ReturnType<typeof createRunPreparationScenario>
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
  return {
    transport,
    workflowDefinitions,
    runPreparationPort,
    executionRead,
    deviceActions,
    runPreparation: createRunPreparationScenario(workflowDefinitions, runPreparationPort)
  }
}
