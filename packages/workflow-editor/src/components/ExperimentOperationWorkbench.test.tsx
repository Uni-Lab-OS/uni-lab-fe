import type {
  WorkflowActionNodeTemplate,
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
  createExperimentOperationActionNode,
  experimentOperationParameterFields,
  groupExperimentOperationActions
} from './experimentOperationProjection'

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
    expect(workbench).not.toContain('<ExperimentOperationCanvas')
    expect(view).toMatch(
      /<PersistentWorkflowOverlays[\s\S]*?definitionKind=\{definitionKind\}/u
    )
    expect(overlays).toContain('<WorkflowIoEditor')
    expect(overlays).toContain("definitionKind === 'operation'")
    expect(inspector).toContain('<WorkflowActionParameterEditor')
    expect(parameterEditor).toContain('title="设备参数"')
    expect(parameterEditor).toContain('description="输入与输出契约"')
    expect(parameterEditor).toContain('className="mapping-row"')
    expect(outputList).not.toContain('<input')
    expect(outputList).not.toContain('<select')
  })

  it('groups only catalog-backed actions and filters by public labels', () => {
    const templates = [
      actionTemplate({
        uuid: 'action-reset',
        actionClass: 'RobotArm',
        displayName: '设备复位',
        actionType: 'reset'
      }),
      actionTemplate({
        uuid: 'action-feed',
        actionClass: 'FeedStation',
        displayName: '定量投料',
        actionType: 'execute_feed'
      })
    ]

    expect(groupExperimentOperationActions(templates)).toHaveLength(2)
    expect(groupExperimentOperationActions(templates, '投料')).toEqual([
      expect.objectContaining({
        key: 'FeedStation',
        templates: [expect.objectContaining({ uuid: 'action-feed' })]
      })
    ])
  })

  it('projects action schema fields and defaults into a local draft only', () => {
    const template = actionTemplate({
      schema: {
        type: 'object',
        required: ['target_mass'],
        properties: {
          target_mass: {
            type: 'number',
            title: '目标质量',
            description: '本次投料的目标质量。'
          }
        }
      },
      goalDefault: { target_mass: 250 }
    })
    const node = createExperimentOperationActionNode(
      template,
      { x: 10, y: 20 },
      'draft-node'
    )

    expect(node).toMatchObject({
      id: 'draft-node',
      kind: 'action',
      position: { x: 10, y: 20 },
      parameterValues: { target_mass: 250 }
    })
    expect(experimentOperationParameterFields(node)).toEqual([
      expect.objectContaining({
        key: 'target_mass',
        label: '目标质量',
        type: 'number',
        required: true,
        value: 250
      })
    ])
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
  overrides: Partial<WorkflowActionNodeTemplate> = {}
): WorkflowActionNodeTemplate {
  return {
    uuid: 'action-template',
    resourceTemplateUuid: 'resource-template',
    name: 'reset',
    displayName: '设备复位',
    actionClass: 'RobotArm',
    actionType: 'reset',
    schema: {},
    goal: {},
    goalDefault: {},
    handles: [],
    ...overrides
  }
}
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
