import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8')
describe('intervention host lifetime', () => {
  it('mounts outside kernel page and workflow-panel lifetime', () => {
    const app = read('../../../apps/kernel-web/src/App.tsx')
    expect(app).toContain('<ActiveWorkflowInterventions />')
    expect(app.indexOf('<ActiveWorkflowInterventions />')).toBeLessThan(app.lastIndexOf('{children}'))
    expect(read('./components/WorkflowPanel.tsx')).not.toContain('<WorkflowInterventions')
  })
  it('mounts once above Theia view-mode surfaces and portals outside hidden widgets', () => {
    const host = read('../../workbench-theia/src/browser/unilab-workbench-widget.tsx')
    expect(host).toContain('this.title.closable = false')
    expect(host.match(/<WorkflowInterventions runtime=/g)).toHaveLength(1)
    expect(host).toContain('<WorkbenchInterventionHost snapshot={this.sessionSnapshot}')
    expect(host).toContain('{this.renderWorkbench()}')
    expect(host).toContain('online={snapshot.phase === \'ready\'}')
    expect(host).toContain('managedLocalUrl: lastIdentity.current?.backendUrl')
    expect(read('./components/WorkflowInterventions.tsx')).toContain('createPortal(view, document.body)')
  })
})
