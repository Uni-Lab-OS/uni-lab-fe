import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  DeviceExecutionOccupancySummary,
  DeviceListItem,
  DeviceWorkspace
} from './DevicePanelViews'
import { deviceActionReadiness } from './DeviceActionAvailability'

describe('device status presentation', () => {
  it('shows connection, dispatch block, and execution occupancy independently', () => {
    const executionOccupancies = [{
      leaseUuid: '70000000-0000-4000-8000-000000000001',
      workflowTaskUuid: '80000000-0000-4000-8000-000000000001',
      workflowNodeJobUuid: '90000000-0000-4000-8000-000000000001',
      state: 'uncertain' as const,
      actionName: 'dose',
      acquiredAt: '2026-08-16T08:00:00Z'
    }]
    const device = {
      id: 'pump-1',
      materialUuid: '10000000-0000-4000-8000-000000000001',
      deviceKey: '/devices/pump-1',
      namespace: '/devices',
      machineName: '一号泵',
      online: true,
      edgeStatus: 'online' as const,
      dispatchable: false,
      dispatchBlockReason: 'unresolved_unknown_command:workflow-node-job:old-job',
      executionOccupancies,
      actions: [{
        actionName: 'dose',
        actionRef: 'pump-1.dose',
        displayName: '加液',
        label: '加液',
        typeName: 'Dose',
        isBusy: false,
        currentJobId: null,
        schema: null,
        inputSchema: {},
        outputSchema: {},
        riskLevel: 'normal' as const
      }],
      displayName: '一号泵',
      displayDetail: '本地'
    }

    const listMarkup = renderToStaticMarkup(
      <DeviceListItem device={device} selected onSelect={() => {}} />
    )
    const detailMarkup = renderToStaticMarkup(
      <DeviceExecutionOccupancySummary occupancies={executionOccupancies} />
    )

    expect(listMarkup).toContain('在线')
    expect(listMarkup).toContain('派发受阻')
    expect(listMarkup).toContain('执行占用')
    expect(detailMarkup).toContain('不确定占用')
    expect(detailMarkup).toContain('需要完成安全核验')
    expect(detailMarkup).not.toContain('手动解锁')
  })

  /** 证明旧 Backend 未提供占用字段时，前端不会把未知状态伪装成空闲。 */
  it('keeps missing occupancy projections explicit', () => {
    const action = {
      actionName: 'dose',
      actionRef: 'pump-1.dose',
      displayName: '加液',
      label: '加液',
      typeName: 'Dose',
      isBusy: false,
      busyStatusKnown: false,
      currentJobId: null,
      schema: null,
      inputSchema: {},
      outputSchema: {},
      riskLevel: 'normal' as const
    }

    expect(deviceActionReadiness({
      action,
      device: {
        id: 'pump-1',
        materialUuid: '10000000-0000-4000-8000-000000000001',
        deviceKey: '/devices/pump-1',
        namespace: '/devices',
        machineName: '一号泵',
        online: true,
        edgeStatus: 'online',
        dispatchable: true,
        dispatchBlockReason: null,
        executionOccupancies: null,
        actions: [action],
        displayName: '一号泵',
        displayDetail: '本地'
      },
      template: {
        uuid: '30000000-0000-4000-8000-000000000001',
        resourceTemplateUuid: '40000000-0000-4000-8000-000000000001',
        name: 'dose',
        displayName: '加液',
        actionClass: null,
        actionType: 'Dose',
        schema: { type: 'object', properties: {} },
        goal: {},
        goalDefault: {},
        handles: []
      },
      canRunActionTask: true,
      connection: 'connected',
      catalogLoading: false,
      catalogError: null
    })).toMatchObject({
      kind: 'ready',
      message: expect.stringContaining('未提供占用明细')
    })
  })

  it('presents unavailable occupancy as a connection or scheduling step', () => {
    const action = {
      actionName: 'dose',
      actionRef: 'pump-1.dose',
      displayName: '加液',
      label: '加液',
      typeName: 'Dose',
      isBusy: false,
      busyStatusKnown: false,
      currentJobId: null,
      schema: null,
      inputSchema: {},
      outputSchema: {},
      riskLevel: 'normal' as const
    }
    const device = {
      id: 'pump-1',
      materialUuid: '10000000-0000-4000-8000-000000000001',
      deviceKey: '/devices/pump-1',
      namespace: '/devices',
      machineName: '一号泵',
      online: false,
      edgeStatus: 'offline' as const,
      dispatchable: false,
      dispatchBlockReason: null,
      executionOccupancies: null,
      actions: [action],
      displayName: '一号泵',
      displayDetail: '本地'
    }
    const renderWorkspace = (edgeStatus: 'offline' | 'online') =>
      renderToStaticMarkup(
        <DeviceWorkspace
          device={{
            ...device,
            online: edgeStatus === 'online',
            edgeStatus,
            dispatchable: edgeStatus === 'online'
          }}
          selectedAction={action}
          selectedActionRef={action.actionRef}
          argumentDraft={{}}
          onSelectAction={() => {}}
          onArgumentChange={() => {}}
          actionTemplate={null}
          actionCatalogLoading={false}
          actionCatalogError={null}
          canRunActionTask={false}
          connection={edgeStatus === 'online' ? 'connected' : 'disconnected'}
          runState={null}
          activeRunActionRef={null}
          onRunAction={() => {}}
          onCancelActionTask={() => {}}
          canForceUnlock={false}
          unlockOperation={null}
          onRequestUnlock={() => {}}
        />
      )

    const offlineMarkup = renderWorkspace('offline')
    expect(offlineMarkup).toContain('等待 Edge 连接')
    expect(offlineMarkup).toContain('等待连接')
    expect(offlineMarkup).not.toContain('占用未提供')

    const onlineMarkup = renderWorkspace('online')
    expect(onlineMarkup).toContain('设备动作')
    expect(onlineMarkup).toContain('初始化配置')
    expect(onlineMarkup).toContain('设备实时状态')
    expect(onlineMarkup).not.toContain('提交时确认')
    expect(onlineMarkup).not.toContain('当前服务未提供占用明细')
    expect(onlineMarkup).not.toContain('占用未提供')
  })
})
