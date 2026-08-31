import type {
  DeviceActionDeclarationDevice,
  WorkflowActionNodeTemplate
} from '@unilab/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  ExperimentOperationDeviceCatalog,
  projectExperimentOperationDeviceActions
} from './ExperimentOperationDeviceCatalog'

describe('ExperimentOperationDeviceCatalog', () => {
  it('joins reported devices and Actions to the unique executable template', () => {
    const projection = projectExperimentOperationDeviceActions(
      devices,
      templates,
      ''
    )

    expect(projection).toMatchObject({
      deviceCount: 1,
      declaredActionCount: 1,
      matchedActionCount: 1,
      devices: [{
        deviceId: 'material-s07',
        actions: [{
          actionName: 'dose_powder',
          template: { uuid: 'template-dose' }
        }]
      }]
    })
    expect(projection.unboundTemplates.map(item => item.uuid))
      .toEqual(['template-scan'])
  })

  it('renders device identity, status, reported Action and unmatched templates', () => {
    const markup = renderToStaticMarkup(
      <ExperimentOperationDeviceCatalog
        devices={devices}
        templates={templates}
        query=""
        loading={false}
        error={null}
        disabled={false}
        disabledReason=""
        onRefresh={vi.fn()}
        onAddAction={vi.fn()}
      />
    )

    expect(markup).toContain('S07 固体加料')
    expect(markup).toContain('s07-solid-feeder')
    expect(markup).toContain('在线')
    expect(markup).toContain('定量加粉')
    expect(markup).toContain('扫描料盒')
    expect(markup).toContain('1 台 · 1 项')
  })
})

const devices: DeviceActionDeclarationDevice[] = [{
  id: 'material-s07',
  materialUuid: 'material-s07',
  resourceTemplateUuid: 'resource-s07',
  deviceKey: 's07-solid-feeder',
  namespace: 'edge-szlab',
  machineName: 'S07 固体加料',
  online: true,
  edgeStatus: 'online',
  dispatchable: true,
  dispatchBlockReason: null,
  actions: [{
    actionName: 'dose_powder',
    typeName: 'UniLabJsonCommand',
    isBusy: false,
    currentJobId: null
  }]
}]

const templates: WorkflowActionNodeTemplate[] = [
  actionTemplate({
    uuid: 'template-dose',
    name: 'dose_powder',
    displayName: '定量加粉'
  }),
  actionTemplate({
    uuid: 'template-scan',
    name: 'scan_cartridges',
    displayName: '扫描料盒'
  })
]

function actionTemplate(
  overrides: Partial<WorkflowActionNodeTemplate>
): WorkflowActionNodeTemplate {
  return {
    uuid: 'template-action',
    resourceTemplateUuid: 'resource-s07',
    name: 'action',
    displayName: '设备动作',
    actionClass: 'SolidFeeder',
    actionType: 'UniLabJsonCommand',
    schema: {},
    goal: {},
    goalDefault: {},
    handles: [],
    ...overrides
  }
}
