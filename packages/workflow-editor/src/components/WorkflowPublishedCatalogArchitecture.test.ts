import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const panelPath = fileURLToPath(new URL(
  './PersistentWorkflowAuthoringPanel.tsx',
  import.meta.url
))
const dagPath = fileURLToPath(new URL('./WorkflowDag.tsx', import.meta.url))

describe('Published Workflow Catalog in the original Authoring panel', () => {
  it('renders separate Action and child Workflow palette groups from one union snapshot', () => {
    const source = readFileSync(panelPath, 'utf8')
    const actionPicker = paletteSection(source, '操作')
    const workflowPicker = paletteSection(source, '子工作流')

    expect(actionPicker).toContain('actionTemplates.map')
    expect(actionPicker).toMatch(
      /<button[\s\S]*?key=\{template\.uuid\}[\s\S]*?\{template\.displayName\}/
    )
    expect(workflowPicker).toContain('workflowTemplates.map')
    expect(workflowPicker).toMatch(
      /<button[\s\S]*?key=\{template\.uuid\}[\s\S]*?\{template\.displayName\}/
    )
  })

  it('does not present the Published Workflow renderer owner as a device', () => {
    const workflowPicker = paletteSection(
      readFileSync(panelPath, 'utf8'),
      '子工作流'
    )

    expect(workflowPicker).not.toMatch(
      /host_node|Host Node|resourceTemplate|device|设备/i
    )
    expect(workflowPicker).toContain('template.displayName')
    expect(workflowPicker).toContain('template.uuid')
  })

  it('enables child selection through the Published boundary insertion seam', () => {
    const source = readFileSync(panelPath, 'utf8')
    const workflowPicker = paletteSection(source, '子工作流')

    expect(source).toContain('createPublishedWorkflowNode')
    expect(workflowPicker).toMatch(
      /disabled=\{[\s\S]*?busy[\s\S]*?canvasMutationEnabled[\s\S]*?graph[\s\S]*?\}/
    )
    expect(workflowPicker).toMatch(
      /onClick=\{\(\) => addPublishedWorkflowNode\(template\.uuid\)\}/
    )
    expect(source).toContain('globalThis.crypto.randomUUID()')
  })

  it('renders OS diagnostic code and message without frontend replacement', () => {
    const source = readFileSync(panelPath, 'utf8')

    expect(source).toContain('<code>{diagnostic.code}</code>')
    expect(source).toContain('<span>{diagnostic.message}</span>')
    expect(source).not.toMatch(/composite_[a-z_]+\s*:\s*['"`]/)
  })

  it('keeps Composite expansion session-only and resets it on OS graph identity changes', () => {
    const source = readFileSync(dagPath, 'utf8')
    const toggle = functionBody(source, 'const toggleGroup')

    expect(source).toContain('projectNestedWorkflow(nodes, links, expandedGroupIds)')
    expect(source).toMatch(
      /groupSignature[\s\S]*?node\.compositeSignature/
    )
    expect(source).toMatch(
      /useEffect\(\(\) => \{\s*setExpandedGroupIds\(new Set\(\)\)\s*\}, \[groupSignature\]\)/
    )
    expect(toggle).toContain('setExpandedGroupIds')
    expect(toggle).not.toMatch(
      /onConnect|onGraphChange|fetch|runtime\.|setNodes|setEdges/
    )
  })

  it('keeps Catalog loading behind the runtime without a Published-specific loader', () => {
    const source = readFileSync(panelPath, 'utf8')
    const catalogMethods = [...source.matchAll(
      /runtime\.(getWorkflow[A-Za-z]+Catalog)\(/g
    )].map((match) => match[1])

    expect(catalogMethods.length).toBeGreaterThan(0)
    expect(new Set(catalogMethods)).toEqual(new Set([
      'getWorkflowActionCatalog',
      'getWorkflowMaterialSourceCatalog'
    ]))
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toContain('/api/v1/workflow-node-templates')
    expect(source).not.toMatch(/getPublishedWorkflowCatalog/)
    expect(source).not.toMatch(/loadPublishedWorkflowCatalog/)
    expect(source).not.toMatch(/\bprofile(?:Id|Kind|Name)?\b/i)
  })
})

function paletteSection(source: string, label: string): string {
  const start = source.indexOf(`<h3>${label}</h3>`)
  expect(start, `${label} palette must remain in the original panel`)
    .toBeGreaterThanOrEqual(0)
  const end = source.indexOf('</section>', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration)
  expect(start, `${declaration} must exist`).toBeGreaterThanOrEqual(0)
  const tail = source.slice(start)
  const end = tail.indexOf('\n  }, [])')
  expect(end, `${declaration} must remain a local callback`).toBeGreaterThan(0)
  return tail.slice(0, end)
}
