import type { WorkflowRuntimePort, WorkflowSummary } from '@unilab/services'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  ExperimentOperationWorkbench,
  filterExperimentOperationDefinitions
} from './ExperimentOperationWorkbench'

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
      parameterEditor.indexOf('persistent-authoring__output-list'),
      parameterEditor.indexOf('</ParameterSection>',
        parameterEditor.indexOf('persistent-authoring__output-list'))
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
    expect(parameterEditor).toContain('title="输出参数"')
    expect(parameterEditor).toContain('输出类型由 OS 操作模板定义')
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

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
