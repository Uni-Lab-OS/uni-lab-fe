import { describe, expect, it } from 'vitest'
import type {
  PreflightReport,
  RunConfiguration,
  SubmittedRun,
} from '../../domain/run-preparation/model'
import type { RunPreparationScenario } from './scenario'
import { createRunPreparationStore } from './store'

describe('createRunPreparationStore', () => {
  it('合并同一工作流的并发加载，切换后忽略旧请求，并允许失败后重试', async () => {
    const pending: {
      uuid: string
      resolve: (value: any) => void
      reject: (error: Error) => void
    }[] = []
    const scenario = {
      load(uuid: string) {
        return new Promise((resolve, reject) => pending.push({ uuid, resolve, reject }))
      },
    } as unknown as RunPreparationScenario
    const store = createRunPreparationStore(scenario)
    const first = store.getState().load('a')
    const duplicate = store.getState().load('a')
    expect(duplicate).toBe(first)
    expect(pending).toHaveLength(1)
    const next = store.getState().load('b')
    pending[1]!.resolve({ revision: { workflowUuid: 'b' } })
    await next
    pending[0]!.reject(new Error('旧请求超时'))
    await first
    expect(store.getState()).toMatchObject({ status: 'ready', workflowUuid: 'b', error: null })
    expect(store.getState().viewModel?.revision.workflowUuid).toBe('b')
    const failed = store.getState().load('c')
    expect(store.getState().viewModel).toBeNull()
    pending[2]!.reject(new Error('读取失败'))
    await failed
    expect(store.getState().status).toBe('error')
    const retry = store.getState().load('c')
    pending[3]!.resolve({ revision: { workflowUuid: 'c' } })
    await retry
    expect(store.getState().status).toBe('ready')
  })

  it('keeps commands as safe no-ops before a workflow is loaded', async () => {
    const store = createRunPreparationStore({} as RunPreparationScenario)

    await store.getState().requestPreflight()
    await store.getState().submitRun()
    await store.getState().inspectNodeJob('job-1')
    store.getState().updateConfiguration({ description: 'ignored' })
    store.getState().updateBinding({ selectedResources: { device: 'ignored' } })

    expect(store.getState()).toMatchObject({
      status: 'idle',
      viewModel: null,
      preflight: null,
      submittedRun: null,
      error: null,
    })
  })

  it('keeps draft state in Zustand and sends the latest draft through the scenario', async () => {
    let receivedConfiguration: RunConfiguration | undefined
    const scenario: RunPreparationScenario = {
      async load(workflowUuid, state) {
        return {
          kind: 'run_preparation',
          revision: {
            kind: 'published_revision',
            source: 'fixture',
            workflowUuid,
            name: 'Example workflow',
            revision: 1,
            workflowType: 'workflow',
            status: 'published',
            graph: {
              workflow: { uuid: workflowUuid },
              nodes: [],
              edges: [],
              nodeTemplates: [],
              handleTemplates: [],
              inventoryRequirements: [],
            },
          },
          ...state,
          requirements: [],
          nodeJob: null,
        }
      },
      async requestPreflight(state): Promise<PreflightReport> {
        receivedConfiguration = state.configuration
        return {
          kind: 'preflight_report',
          source: 'fixture',
          workflowUuid: state.revision.workflowUuid,
          workflowRevision: state.revision.revision,
          runMode: state.configuration.runMode,
          status: 'runnable_now',
          canRun: true,
          checkedAt: '2026-09-24T00:00:00Z',
          checks: [],
        }
      },
      async submitRun(): Promise<SubmittedRun> {
        return {
          kind: 'submitted_run',
          source: 'fixture',
          taskUuid: 'task-1',
          raw: {},
        }
      },
      async inspectNodeJob(viewModel, jobUuid) {
        return {
          ...viewModel,
          nodeJob: {
            kind: 'node_job_detail',
            source: 'fixture',
            jobUuid,
            workflowTaskUuid: 'task-1',
            workflowNodeUuid: 'node-1',
            executorKind: 'device',
            logicalStatus: 'running',
            attempt: 1,
            raw: {},
          },
        }
      },
    }

    const store = createRunPreparationStore(scenario)
    await store.getState().load('workflow-1')
    store.getState().updateConfiguration({
      runMode: 'single_node',
      targetNodeUuid: 'node-1',
    })
    await store.getState().requestPreflight()

    expect(receivedConfiguration).toEqual({
      runMode: 'single_node',
      targetNodeUuid: 'node-1',
      input: {},
    })
    expect(store.getState().preflight?.canRun).toBe(true)
    expect(store.getState().status).toBe('ready')

    await store.getState().submitRun()
    expect(store.getState().submittedRun).toMatchObject({ taskUuid: 'task-1' })
    expect(store.getState().status).toBe('ready')

    await store.getState().inspectNodeJob('job-1')
    expect(store.getState().viewModel?.nodeJob?.jobUuid).toBe('job-1')
  })

  it('卸载期间进行中的检查不被重新加载覆盖，已完成的旧结果在离开时丢弃', async () => {
    let finishPreflight!: (report: PreflightReport) => void
    let loads = 0
    const scenario: RunPreparationScenario = {
      async load(workflowUuid, state) {
        loads += 1
        return {
          kind: 'run_preparation',
          revision: {
            kind: 'published_revision',
            source: 'fixture',
            workflowUuid,
            name: 'Example workflow',
            revision: 1,
            workflowType: 'workflow',
            status: 'published',
            graph: {
              workflow: { uuid: workflowUuid },
              nodes: [],
              edges: [],
              nodeTemplates: [],
              handleTemplates: [],
              inventoryRequirements: [],
            },
          },
          ...state,
          requirements: [],
          nodeJob: null,
        }
      },
      requestPreflight() {
        return new Promise<PreflightReport>((resolve) => {
          finishPreflight = resolve
        })
      },
      async submitRun(): Promise<SubmittedRun> {
        throw new Error('not used')
      },
      async inspectNodeJob() {
        throw new Error('not used')
      },
    }
    const store = createRunPreparationStore(scenario)
    await store.getState().load('wf-1')
    const pending = store.getState().requestPreflight()
    expect(store.getState().status).toBe('preflighting')

    await store.getState().load('wf-1')
    expect(loads).toBe(1)
    expect(store.getState().status).toBe('preflighting')

    store.getState().discardSettledResults()
    expect(store.getState().status).toBe('preflighting')

    const report = { kind: 'preflight_report', canRun: true } as unknown as PreflightReport
    finishPreflight(report)
    await pending
    expect(store.getState().preflight).toBe(report)

    await store.getState().load('wf-1')
    expect(loads).toBe(1)

    store.getState().discardSettledResults()
    expect(store.getState().preflight).toBeNull()
    await store.getState().load('wf-1')
    expect(loads).toBe(2)
  })

  it('restoreDraft 恢复入参与检查结果且不发起请求，未加载时为空操作', async () => {
    let loads = 0
    const scenario = {
      async load(workflowUuid: string, state: unknown) {
        loads += 1
        return {
          kind: 'run_preparation',
          revision: { workflowUuid, graph: { nodes: [], edges: [] } },
          ...(state as object),
          requirements: [],
          nodeJob: null,
        }
      },
    } as unknown as RunPreparationScenario
    const store = createRunPreparationStore(scenario)
    const report = { kind: 'preflight_report', canRun: false } as unknown as PreflightReport
    const configuration: RunConfiguration = {
      runMode: 'normal',
      description: '恢复的任务',
      input: { sample_id: 'sim-01' },
    }

    store.getState().restoreDraft({ configuration, preflight: report })
    expect(store.getState().viewModel).toBeNull()

    await store.getState().load('wf-1')
    store.getState().restoreDraft({ configuration, preflight: report })

    expect(loads).toBe(1)
    expect(store.getState().viewModel?.configuration).toEqual(configuration)
    expect(store.getState().preflight).toBe(report)
  })
})
