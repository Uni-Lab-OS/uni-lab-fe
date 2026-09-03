import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const panelPath = fileURLToPath(new URL(
  './PersistentWorkflowAuthoringPanel.tsx',
  import.meta.url
))
const viewPath = fileURLToPath(new URL(
  './PersistentWorkflowAuthoringView.tsx',
  import.meta.url
))
const palettePath = fileURLToPath(new URL(
  './WorkflowNodePalette.tsx',
  import.meta.url
))
const deviceLibraryPath = fileURLToPath(new URL(
  './ExperimentOperationDeviceLibrary.tsx',
  import.meta.url
))
const deviceCatalogPath = fileURLToPath(new URL(
  './ExperimentOperationDeviceCatalog.tsx',
  import.meta.url
))
const authoringHookPath = fileURLToPath(new URL(
  '../hooks/usePersistentWorkflowAuthoring.ts',
  import.meta.url
))
const catalogHookPath = fileURLToPath(new URL(
  '../hooks/usePersistentWorkflowCatalogs.ts',
  import.meta.url
))
const canvasNodeEditorHookPath = fileURLToPath(new URL(
  '../hooks/usePersistentWorkflowCanvasNodeEditor.ts',
  import.meta.url
))
const overlaysPath = fileURLToPath(new URL(
  './PersistentWorkflowOverlays.tsx',
  import.meta.url
))
const dagPath = fileURLToPath(new URL('./WorkflowDag.tsx', import.meta.url))

describe('Published Workflow Catalog in the Authoring module', () => {
  /** 验证操作与子工作流继续由同一目录快照分别呈现。 */
  it('renders separate Action and child Workflow palette groups from one union snapshot', () => {
    const source = authoringSource()
    const actionPicker = paletteSection(source, '操作')
    const workflowPicker = paletteSection(source, '子工作流')

    expect(actionPicker).toContain('visibleTemplates.map')
    expect(actionPicker).toMatch(
      /<WorkflowButton[\s\S]*?key=\{template\.uuid\}[\s\S]*?\{template\.displayName\}/
    )
    expect(workflowPicker).toContain('projection.workflows.map')
    expect(workflowPicker).toMatch(
      /<WorkflowButton[\s\S]*?key=\{template\.uuid\}[\s\S]*?\{template\.displayName\}/
    )
  })

  it('requires dragging action entries onto the canvas instead of click insertion', () => {
    const paletteSource = readFileSync(palettePath, 'utf8')
    const deviceLibrarySource = readFileSync(deviceLibraryPath, 'utf8')
    const deviceCatalogSource = readFileSync(deviceCatalogPath, 'utf8')

    expect(paletteSection(paletteSource, '操作')).toContain('onDragStart')
    expect(paletteSection(paletteSource, '操作')).not.toMatch(
      /onClick=\{\(\) => onAddAction\(/u
    )
    expect(deviceLibrarySource).not.toMatch(
      /onClick=\{\(\) => onAddAction\??\(/u
    )
    expect(deviceCatalogSource).not.toMatch(
      /onClick=\{\(\) => \{[\s\S]*onAddAction\(/u
    )
  })

  it('does not present the Published Workflow renderer owner as a device', () => {
    const workflowPicker = paletteSection(
      readFileSync(palettePath, 'utf8'),
      '子工作流'
    )

    expect(workflowPicker).not.toMatch(
      /host_node|Host Node|resourceTemplate|device|设备/i
    )
    expect(workflowPicker).toContain('template.displayName')
    expect(workflowPicker).toContain('template.uuid')
  })

  it('enables child selection through the Published boundary insertion seam', () => {
    const source = authoringSource()
    const workflowPicker = paletteSection(source, '子工作流')

    expect(source).toContain('createPublishedWorkflowNode')
    expect(workflowPicker).toMatch(
      /disabled=\{templateDisabled\}/
    )
    expect(workflowPicker).toMatch(
      /onClick=\{\(\) => onAddWorkflow\(template\.uuid\)\}/
    )
    expect(source).toContain('globalThis.crypto.randomUUID()')
  })

  it('renders OS diagnostic code and message without frontend replacement', () => {
    const source = readFileSync(viewPath, 'utf8')

    expect(source).toContain('<code>{diagnostic.code}</code>')
    expect(source).toContain('<span>{diagnostic.message}</span>')
    expect(source).not.toMatch(/composite_[a-z_]+\s*:\s*['"`]/)
  })

  it('keeps Composite expansion session-only and resets it on OS graph identity changes', () => {
    const source = readFileSync(dagPath, 'utf8')
    const toggle = functionBody(source, 'const toggleGroup')

    expect(source).toMatch(
      /projectNestedWorkflow\(nodes, links, expandedGroupIds\)/
    )
    expect(source).toMatch(
      /projectMaterialTraces\([\s\S]*?hierarchyProjection\.nodes,[\s\S]*?hierarchyProjection\.links/
    )
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
    const source = authoringSource()
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

  it('isolates action catalog failures from MaterialSource authority and retries them', () => {
    const source = readFileSync(catalogHookPath, 'utf8')

    expect(source).toContain('catalogRequestGeneration')
    expect(source).toContain(
      'requestGeneration !== catalogRequestGeneration.current'
    )
    expect(source).not.toContain('setError(errorMessage(catalogError))')
    expect(source).toContain('setActionCatalogError')
    expect(source).toContain('ACTION_CATALOG_RETRY_DELAY_MS')
    expect(source).not.toMatch(
      /if \(\s*materialSourceCatalogLoading \|\|[\s\S]{0,120}!materialSourceCatalog/u
    )
    expect(source).not.toMatch(
      /setMaterialSourceCatalogError\(\s*`操作目录加载失败：/
    )
  })

  it('clears an obsolete transport error after authority is installed', () => {
    const source = readFileSync(authoringHookPath, 'utf8')
    const installStart = source.indexOf('const installAggregate = useCallback')
    const installEnd = source.indexOf('\n  useEffect(() => {', installStart)
    const installAggregate = source.slice(installStart, installEnd)

    expect(installAggregate).toContain('setAggregate(next)')
    expect(installAggregate).toContain('setError(null)')
    expect(installAggregate.indexOf('setError(null)')).toBeLessThan(
      installAggregate.indexOf('setMessage(nextMessage)')
    )
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

function authoringSource(): string {
  return [
    panelPath,
    viewPath,
    palettePath,
    authoringHookPath,
    catalogHookPath,
    canvasNodeEditorHookPath,
    overlaysPath
  ]
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n')
}

function functionBody(source: string, declaration: string): string {
  const start = source.indexOf(declaration)
  expect(start, `${declaration} must exist`).toBeGreaterThanOrEqual(0)
  const tail = source.slice(start)
  const end = tail.indexOf('\n  }, [])')
  expect(end, `${declaration} must remain a local callback`).toBeGreaterThan(0)
  return tail.slice(0, end)
}
