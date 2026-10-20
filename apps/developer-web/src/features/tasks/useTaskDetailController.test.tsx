import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import {
  createWorkflowDebuggingViewModel,
  type WorkflowDebuggingQuery,
  type WorkflowDebuggingScenario,
} from '@unilab-fe/core'
import { taskSummaryPage } from '../../../test/taskSummaryFixtures'
import { useTaskDetailController } from './useTaskDetailController'

const { holder, connection } = vi.hoisted(() => ({
  connection: { readyEpoch: 0, reportSuccess: () => undefined, reportError: () => undefined },
  holder: { current: null as unknown as ReturnType<typeof makeBackend> },
}))
vi.mock('../../app/BackendProvider', () => ({
  useBackend: () => ({ backend: holder.current, ...connection }),
}))

function makeBackend(summary: boolean) {
  const load = vi.fn(async (query: WorkflowDebuggingQuery = {}) =>
    createWorkflowDebuggingViewModel(query, taskSummaryPage([])),
  )
  return {
    getCapabilityStatus: (capability: string) => ({
      available: summary && capability === 'workflow.taskPresentationSummary',
    }),
    core: {
      workflowDebugging: { load } as unknown as WorkflowDebuggingScenario,
      deviceActions: { listDevices: vi.fn(async () => []) },
      deviceActionPresentations: { getActionPresentations: vi.fn() },
    },
    load,
  }
}

beforeEach(() => {
  holder.current = makeBackend(false)
})

describe('useTaskDetailController task list', () => {
  it('reads the side task list through the summary view when the profile declares it', async () => {
    holder.current = makeBackend(true)
    renderHook(() => useTaskDetailController())
    await waitFor(() =>
      expect(holder.current.load).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        taskListView: 'summary',
      }),
    )
  })

  it('keeps the default presentation view otherwise', async () => {
    renderHook(() => useTaskDetailController())
    await waitFor(() =>
      expect(holder.current.load).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        taskListView: 'presentation',
      }),
    )
  })
})
