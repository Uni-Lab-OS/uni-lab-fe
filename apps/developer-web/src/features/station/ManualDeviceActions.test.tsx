import { beforeAll, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { decodeStationSnapshot, StationErrorHandlingClient } from '@unilab-fe/core'
import { ManualDeviceActions } from './ManualDeviceActions'

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
})

const { backend } = vi.hoisted(() => ({ backend: { core: {} as Record<string, unknown> } }))
vi.mock('../../app/BackendProvider', () => ({ useBackend: () => ({ backend }) }))

const snapshot = decodeStationSnapshot({
  station_id: 'local',
  mode: 'PAUSED',
  error_epoch: 1,
  station_version: 5,
  snapshot_id: 'local:5:1',
  active_session: {
    session_id: 's1',
    decision_id: 'd1',
    stage: 'MANUAL_HANDLING',
    version: 2,
    summary: '',
  },
  manual_actions: [
    {
      uuid: 'm1',
      status: 'running',
      meta_data: { session_id: 's1' },
      action_name: 'init',
      device_id: 'collect',
      uncertainty_reason: 'edge_reported_unknown_commands:x',
      edge_command_uuid: 'c1',
      review_version: 'r1',
    },
  ],
  control_commands: [],
  errors: [
    {
      decision_id: 'd1',
      decision_version: 1,
      source_task_uuid: 't1',
      source_job_uuid: 'j1',
      stage: 'MANUAL_HANDLING',
      status: 'open',
      options: [],
      meta_data: {},
    },
  ],
})

describe('ManualDeviceActions', () => {
  it('defaults to the failed job device, loads its OS action catalog and dispatches a versioned action', async () => {
    const real = new StationErrorHandlingClient(
      { request: vi.fn() } as never,
      'local',
      '/api/v1',
      () => 'key-1',
    )
    const listDeviceActions = vi
      .fn()
      .mockResolvedValue([
        {
          actionId: 'a-init',
          name: 'init',
          displayName: 'init',
          actionVersion: 'v1',
          parameterSchema: {},
          defaults: { force: false },
        },
      ])
    const submit = vi.fn().mockResolvedValue(true)
    backend.core = {
      deviceActions: {
        listDevices: vi
          .fn()
          .mockResolvedValue([
            { materialUuid: 'dev-collect', label: '收集工位', deviceKey: 'collect' },
          ]),
      },
      executionRead: {
        getNodeJobDetail: vi
          .fn()
          .mockResolvedValue({
            controlData: { actual_executor: { material_uuid: 'dev-collect' } },
          }),
      },
      executionRecovery: { resolveUncertainJob: vi.fn() },
      stationErrorHandling: {
        listDeviceActions,
        manualActionIntent: real.manualActionIntent.bind(real),
        reviewManualActionIntent: real.reviewManualActionIntent.bind(real),
      },
    }
    const state = { submit, reload: vi.fn() } as never
    render(
      <ManualDeviceActions
        snapshot={snapshot}
        session={snapshot.activeSession!}
        error={snapshot.errors[0]!}
        state={state}
        writable
      />,
    )
    await waitFor(() => expect(listDeviceActions).toHaveBeenCalledWith('s1', 'dev-collect'))
    // 结果未知且仍在运行的手动动作：先提供“按已取消收尾”，而不是直接登记核对。
    expect(screen.getByRole('button', { name: /按已取消收尾/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /登记核对结论/ })).toBeNull()

    fireEvent.mouseDown(
      within(screen.getByText(/动作（1 个）/).parentElement!).getByRole('combobox'),
    )
    fireEvent.click(await screen.findByTitle('init'))
    fireEvent.click(screen.getByRole('checkbox', { name: /确认现场安全/ }))
    fireEvent.click(screen.getByRole('button', { name: /下发手动动作/ }))
    fireEvent.click(await screen.findByRole('button', { name: /确认下发/ }))
    await waitFor(() => expect(submit).toHaveBeenCalled())
    expect(submit.mock.calls[0]![0]).toMatchObject({
      path: '/sessions/s1/manual-actions',
      body: {
        device_id: 'dev-collect',
        action_id: 'a-init',
        action_version: 'v1',
        parameters: { force: false },
        expected_session_version: 2,
      },
    })
  })
})
