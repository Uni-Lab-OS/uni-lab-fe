import { describe, expect, it } from 'vitest'
import { createWorkflowDebuggingScenario } from './scenario'
import type { WorkflowExecutionReadPort } from '../../domain/workflow-execution-read/port'
import type { WorkflowDefinitionPort } from '../../domain/workflow-definition/port'
import type { WorkflowExecutionControlPort } from '../../domain/workflow-execution-control/port'
import type { WorkflowRuntimeEventsPort } from '../../domain/workflow-runtime-events/port'

describe('workflow debugging scenario', () => {
  it('loads the OS task matrix without composing a runtime summary', async () => {
    const port = fakeExecutionRead()
    const view = await createWorkflowDebuggingScenario(port, fakeWorkflowDefinitions()).load({
      view: 'matrix',
      status: 'running',
    })

    expect(view).toMatchObject({
      kind: 'workflow_debugging',
      query: { view: 'matrix', status: 'running' },
      workflows: [{ workflowUuid: 'workflow-1' }],
      tasks: [{ taskUuid: 'task-1' }],
      selectedTask: null,
      selectedJob: null,
    })
  })

  it('reads task jobs and a selected NodeJob through the execution port', async () => {
    const scenario = createWorkflowDebuggingScenario(fakeExecutionRead(), fakeWorkflowDefinitions())
    const initial = await scenario.load()
    const workflow = await scenario.inspectWorkflow(initial, 'workflow-1')
    const task = await scenario.inspectTask(workflow, 'task-1')
    const job = await scenario.inspectJob(task, 'job-1', { afterSequence: 2, limit: 20 })

    expect(task).toMatchObject({
      selectedTaskUuid: 'task-1',
      selectedTask: { taskUuid: 'task-1' },
      selectedTaskTitle: '测试任务',
      selectedJobs: [{ jobUuid: 'job-1' }],
    })
    expect(task.timeline[0]).toMatchObject({ workflowNodeUuid: 'node-1', nodeLabel: '节点 A' })
    expect(workflow.selectedWorkflow).toMatchObject({ workflowUuid: 'workflow-1' })
    expect(job).toMatchObject({
      selectedJobUuid: 'job-1',
      selectedJob: { workflowTaskUuid: 'task-1', status: 'execution_unknown' },
      feedback: { nextCursor: 3 },
    })
  })

  it('reloads the same query without retaining a stale selection', async () => {
    const scenario = createWorkflowDebuggingScenario(fakeExecutionRead(), fakeWorkflowDefinitions())
    const initial = await scenario.load({ view: 'matrix' })
    const selected = await scenario.inspectTask(initial, 'task-1')
    const reloaded = await scenario.reload(selected)

    expect(reloaded.query).toEqual({ view: 'matrix' })
    expect(reloaded.selectedTaskUuid).toBeNull()
    expect(reloaded.selectedJobs).toEqual([])
  })

  it('keeps command accepted separate and rehydrates after a matching runtime invalidation', async () => {
    let emit:
      | ((event: Parameters<Parameters<WorkflowRuntimeEventsPort['subscribe']>[0]>[0]) => void)
      | undefined
    const control: WorkflowExecutionControlPort = {
      async sendTaskCommand(taskUuid, request) {
        return {
          kind: 'workflow_task_command_receipt',
          commandUuid: 'command-1',
          workflowTaskUuid: taskUuid,
          type: request.type,
          targetNodeUuid: request.targetNodeUuid ?? null,
          idempotencyKey: request.idempotencyKey,
          accepted: true,
          lifecycle: 'accepted',
          statusCode: 201,
          result: {},
          createdAt: null,
          updatedAt: null,
          raw: {},
        }
      },
    }
    const events: WorkflowRuntimeEventsPort = {
      subscribe(listener) {
        emit = listener
        return { dispose: () => undefined }
      },
    }
    const scenario = createWorkflowDebuggingScenario(
      fakeExecutionRead(),
      fakeWorkflowDefinitions(),
      control,
      events,
    )
    const initial = await scenario.inspectTask(await scenario.load(), 'task-1')
    const sent = await scenario.sendCommand(initial, { type: 'step', idempotencyKey: 'idem-1' })
    expect(sent.command.lifecycle).toBe('accepted')
    expect(sent.viewModel.selectedTask?.status).toBe('running')

    const updates: string[] = []
    scenario.subscribeRuntime(initial, (view) => updates.push(view.selectedTaskUuid ?? ''))
    emit?.({
      id: 'event-1',
      event: 'workflow.runtime.changed',
      workflowTaskUuid: 'task-1',
      raw: {},
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(updates).toEqual(['task-1'])
  })
})

function fakeExecutionRead(): WorkflowExecutionReadPort {
  return {
    async listTaskPresentations() {
      return {
        items: [
          {
            kind: 'task_runtime_presentation',
            source: 'os',
            taskUuid: 'task-1',
            workflowUuid: 'workflow-1',
            executionKind: 'workflow',
            status: 'running',
            runMode: 'normal',
            controlStatus: 'active',
            cleanupStatus: 'none',
            priority: null,
            description: null,
            createdAt: 'now',
            updatedAt: 'now',
            finishedAt: null,
            attentionReason: null,
            progress: null,
            jobs: [],
            raw: {},
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        raw: {},
      }
    },
    async listTasks() {
      return { items: [], total: 0, page: 1, pageSize: 20, hasMore: false, raw: {} }
    },
    async getTaskDetail(taskUuid) {
      return {
        kind: 'task_runtime_detail',
        source: 'os',
        taskUuid,
        workflowUuid: 'workflow-1',
        executionKind: 'workflow',
        status: 'running',
        runMode: 'normal',
        controlStatus: 'active',
        cleanupStatus: 'none',
        createdAt: 'now',
        updatedAt: 'now',
        description: '从测试创建',
        raw: {
          workflow_snapshot: {
            workflow: { name: '测试任务' },
            nodes: [{ uuid: 'node-1', name: '节点 A' }],
          },
        },
      }
    },
    async listTaskJobs() {
      return [
        {
          kind: 'task_job_summary',
          source: 'os',
          jobUuid: 'job-1',
          workflowNodeUuid: 'node-1',
          topologicalIndex: 0,
          executorKind: 'device',
          status: 'execution_unknown',
          attempt: 1,
          currentAttempt: true,
          controlData: {},
          errorInfo: [],
          waitReason: {},
          expectedChangeSet: {},
          raw: {},
        },
      ]
    },
    async getNodeJobDetail(jobUuid) {
      return {
        kind: 'node_job_detail',
        source: 'os',
        jobUuid,
        workflowTaskUuid: 'task-1',
        workflowNodeUuid: 'node-1',
        materialUuid: null,
        edgeUuid: null,
        edgeCommandUuid: null,
        feedbackSequence: 3,
        topologicalIndex: 0,
        executorKind: 'device',
        executionPolicy: {},
        executionTimeoutSeconds: null,
        status: 'execution_unknown',
        attempt: 1,
        param: {},
        feedbackData: {},
        returnInfo: {},
        controlData: {},
        errorInfo: [],
        uncertaintyReason: 'unknown',
        dispatchDeadlineAt: null,
        executionDeadlineAt: null,
        cancelCommandUuid: null,
        cancelAckDeadlineAt: null,
        cancelCompleteDeadlineAt: null,
        startedAt: null,
        finishedAt: null,
        raw: {},
      }
    },
    async listNodeJobFeedback() {
      return { items: [], nextCursor: 3, hasMore: false, raw: {} }
    },
  }
}

function fakeWorkflowDefinitions(): WorkflowDefinitionPort {
  return {
    async listPublishedRevisions() {
      return [
        {
          source: 'os',
          workflowUuid: 'workflow-1',
          name: 'Workflow 1',
          revision: 1,
          workflowType: 'workflow',
          status: 'published',
        },
      ]
    },
    async getPublishedRevision(workflowUuid) {
      return {
        kind: 'published_revision',
        source: 'os',
        workflowUuid,
        name: 'Workflow 1',
        revision: 1,
        workflowType: 'workflow',
        status: 'published',
        graph: {
          workflow: {},
          nodes: [],
          edges: [],
          nodeTemplates: [],
          handleTemplates: [],
          inventoryRequirements: [],
        },
      }
    },
  }
}
