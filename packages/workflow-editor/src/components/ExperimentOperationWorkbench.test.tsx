import type {
  WorkflowActionCatalogSnapshot,
  WorkflowRuntimePort,
  WorkflowSummary
} from '@unilab/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ExperimentOperationWorkbench,
  filterExperimentOperationDefinitions
} from './ExperimentOperationWorkbench'
import {
  ExperimentOperationDeviceLibrary,
  groupExperimentOperationDeviceActions
} from './ExperimentOperationDeviceLibrary'

describe('ExperimentOperationWorkbench', () => {
  it('renders an OS-owned operation directory boundary while inactive', () => {
    const markup = renderToStaticMarkup(
      <ExperimentOperationWorkbench
        runtime={{} as WorkflowRuntimePort}
        catalogStatus={{ available: true }}
        active={false}
      />
    )

    expect(markup).toContain('aria-label="实验操作调试工作台"')
    expect(markup).toContain('data-definition-kind="operation"')
    expect(markup).toContain('实验操作目录')
    expect(markup).toContain('进入实验操作调试后读取 OS 权威目录')
    expect(markup).not.toContain('未命名实验操作')
    expect(markup).not.toContain('本地草稿不可派发')
    expect(markup).not.toContain('执行成功')
  })

  it('keeps only OS metadata-marked operation definitions', () => {
    const summaries = [
      workflowSummary('workflow', {}),
      workflowSummary('operation', {
        unilab: { definition_kind: 'operation' }
      })
    ]

    expect(filterExperimentOperationDefinitions(summaries).map(
      workflow => workflow.uuid
    )).toEqual(['operation'])
  })

  it('shows the device action catalog and creation entry before an operation exists', () => {
    const markup = renderToStaticMarkup(
      <ExperimentOperationWorkbench
        runtime={{} as WorkflowRuntimePort}
        catalogStatus={{ available: true }}
        authoringStatus={{ available: true }}
        active
      />
    )

    expect(markup).toContain('操作与节点库')
    expect(markup).toContain('实验操作库')
    expect(markup).toContain('设备动作库')
    expect(markup).toContain('实验流程结构')
    expect(markup).toContain('实验操作参数')
    expect(markup).toContain('新建实验操作')
    expect(markup).not.toContain('设备包尚未发布实验操作')
  })

  it('groups OS actions by device and excludes authoring-only material sources', () => {
    const groups = groupExperimentOperationDeviceActions({
      actionTemplates: [
        actionTemplate(
          'pump-start',
          'pump-template',
          '启动泵',
          'lab.devices:SzlabMixerPumpDevice'
        ),
        actionTemplate(
          'pump-stop',
          'pump-template',
          '停止泵',
          'lab.devices:SzlabMixerPumpDevice'
        ),
        actionTemplate(
          'pump-sim',
          'pump-sim-template',
          '仿真启动泵',
          'lab.devices:SzlabMixerPumpEmbeddedSimDevice'
        ),
        actionTemplate(
          'host-create',
          'host-template',
          '创建物料',
          'unilabos.devices:HostNode'
        ),
        actionTemplate(
          'material-source',
          'material-template',
          '物料来源',
          'unilabos.workflow.authoring:material_source',
          'material_source'
        )
      ],
      workflowTemplates: []
    } satisfies WorkflowActionCatalogSnapshot)

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      resourceTemplateUuid: 'pump-template',
      label: 'S06 注射泵'
    })
    expect(groups[0]?.actions.map(action => action.uuid)).toEqual([
      'pump-start',
      'pump-stop'
    ])
  })

  it('shows device actions expanded and counts only business devices', () => {
    const catalog = {
      actionTemplates: [
        actionTemplate(
          'stir',
          'stirrer-template',
          'S04 烧杯磁搅',
          'lab.devices:SzlabMixerMagneticStirrerDevice'
        ),
        actionTemplate(
          'stir-sim',
          'stirrer-sim-template',
          '仿真磁搅',
          'lab.devices:SzlabMixerMagneticStirrerEmbeddedSimDevice'
        )
      ],
      workflowTemplates: []
    } satisfies WorkflowActionCatalogSnapshot
    const markup = renderToStaticMarkup(
      <ExperimentOperationDeviceLibrary
        catalog={catalog}
        onAddAction={() => undefined}
      />
    )

    expect(markup).toContain('1 台 · 1 项')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('aria-controls="operation-device-actions-stirrer-template"')
    expect(markup).toContain('codicon-chevron-down')
    expect(markup).toContain('S04 烧杯磁搅')
    expect(markup).toContain('draggable="true"')
    expect(markup).not.toContain('仿真磁搅')
  })

  it('keeps actions draggable when insertion is provided by the canvas fallback', () => {
    const markup = renderToStaticMarkup(
      <ExperimentOperationDeviceLibrary
        catalog={{
          actionTemplates: [actionTemplate(
            'stir',
            'stirrer-template',
            'S04 烧杯磁搅',
            'lab.devices:SzlabMixerMagneticStirrerDevice'
          )],
          workflowTemplates: []
        }}
        onPaletteDragStart={() => undefined}
      />
    )

    expect(markup).toContain('data-workflow-palette-action="stir"')
    expect(markup).not.toContain('disabled=""')
    expect(markup).not.toContain('draggable="true"')
  })

  it('keeps the operation and node library mounted across authoring modes', () => {
    const view = componentSource('PersistentWorkflowAuthoringView.tsx')
    const styles = componentSource('_experiment-operation-authoring.scss')

    expect(view).toContain(
      "const operationLibraryPersistent = definitionKind === 'operation'"
    )
    expect(view).not.toContain(
      "hideIdentity={definitionKind === 'operation'}"
    )
    expect(view).toContain(
      'if (!canvasMutationEnabled) return'
    )
    expect(view).toContain("event.dataTransfer.dropEffect = 'copy'")
    expect(view).toContain(
      "(mode === 'canvas' || operationLibraryPersistent)"
    )
    expect(view).toContain(
      'if (compact && !operationLibraryPersistent)'
    )
    expect(styles).toContain(
      '.persistent-authoring--operation[data-definition-kind=\'operation\']'
    )
  })

  it('creates operation definitions with canonical OS metadata', () => {
    const dialogs = componentSource('WorkflowCatalogDialogs.tsx')

    expect(dialogs).toContain("definitionKind = 'workflow'")
    expect(dialogs).toContain("definition_kind: 'operation'")
    expect(dialogs).toContain('创建并进入画布')
  })

  it('reuses Canonical authoring for operation nodes and complete I/O', () => {
    const workbench = componentSource('ExperimentOperationWorkbench.tsx')
    const view = componentSource('PersistentWorkflowAuthoringView.tsx')
    const overlays = componentSource('PersistentWorkflowOverlays.tsx')
    const inspector = componentSource('WorkflowNodeInspector.tsx')
    const parameterEditor = componentSource(
      'WorkflowActionParameterDrawer.tsx'
    )
    const outputList = parameterEditor.slice(
      parameterEditor.indexOf('function MappingSection'),
      parameterEditor.indexOf('function ParameterValueControl')
    )

    expect(workbench).toContain('<PersistentWorkflowAuthoringPanel')
    expect(workbench).toContain('definitionKind="operation"')
    expect(workbench).toContain('initialMode="canvas"')
    expect(workbench).toContain('hideAuthoringToolbar')
    expect(workbench).not.toContain('<ExperimentOperationCanvas')
    expect(view).toMatch(
      /<PersistentWorkflowOverlays[\s\S]*?definitionKind=\{definitionKind\}/u
    )
    expect(overlays).toContain('<WorkflowIoEditor')
    expect(overlays).toContain("definitionKind === 'operation'")
    expect(inspector).toContain('<WorkflowActionParameterEditor')
    expect(inspector).toContain('persistent-authoring__operation-summary')
    expect(inspector).toContain("['runtime', '运行策略']")
    expect(inspector).toContain('hideMaterialFields={operationInspector}')
    expect(view).toContain('persistent-authoring__palette-drag-preview')
    expect(parameterEditor).toContain('title="设备参数"')
    expect(parameterEditor).toContain("'输入与输出契约'")
    expect(parameterEditor).toContain('className="mapping-row"')
    expect(outputList).not.toContain('<input')
    expect(outputList).not.toContain('<select')
  })
})

const componentDirectory = fileURLToPath(new URL('.', import.meta.url))

function componentSource(name: string): string {
  return readFileSync(`${componentDirectory}/${name}`, 'utf8')
}

function workflowSummary(
  uuid: string,
  metaData: Record<string, unknown>
): WorkflowSummary {
  return {
    uuid,
    create_time: '2026-08-28T00:00:00Z',
    update_time: '2026-08-28T00:00:00Z',
    meta_data: metaData,
    name: uuid,
    tags: [],
    revision: 1
  }
}

function actionTemplate(
  uuid: string,
  resourceTemplateUuid: string,
  displayName: string,
  actionClass: string,
  actionType = 'device_action'
): WorkflowActionCatalogSnapshot['actionTemplates'][number] {
  return {
    uuid,
    resourceTemplateUuid,
    name: uuid,
    displayName,
    actionClass,
    actionType,
    schema: {},
    goal: {},
    goalDefault: {},
    handles: []
  }
}

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
