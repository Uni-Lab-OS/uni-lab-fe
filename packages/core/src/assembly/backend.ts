import { createFetchTransport, type FetchTransportOptions } from '../adapters/fetch'
import { WorkflowDefinitionClient } from '../domain/workflow-definition/client'
import { RunPreparationClient } from '../domain/run-preparation/client'
import { createRunPreparationScenario } from '../scenarios/run-preparation/scenario'

export function createBackendCore(options: FetchTransportOptions) {
  const transport = createFetchTransport(options)
  const workflowDefinitions = new WorkflowDefinitionClient(transport)
  const runPreparationPort = new RunPreparationClient(transport)
  return {
    transport,
    workflowDefinitions,
    runPreparationPort,
    runPreparation: createRunPreparationScenario(workflowDefinitions, runPreparationPort)
  }
}
