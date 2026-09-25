import { createFetchTransport, type FetchTransportOptions } from '../adapters/fetch'
import { WorkflowDefinitionClient } from '../domain/workflow-definition/client'
import { RunPreparationClient } from '../domain/run-preparation/client'
import { WorkflowExecutionReadClient } from '../domain/workflow-execution-read/client'
import type { RequestTransport } from '../transport/request'
import { createRunPreparationScenario } from '../scenarios/run-preparation/scenario'

export interface BackendCore {
  readonly transport: RequestTransport
  readonly workflowDefinitions: WorkflowDefinitionClient
  readonly runPreparationPort: RunPreparationClient
  readonly executionRead: WorkflowExecutionReadClient
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
  return {
    transport,
    workflowDefinitions,
    runPreparationPort,
    executionRead,
    runPreparation: createRunPreparationScenario(workflowDefinitions, runPreparationPort)
  }
}
