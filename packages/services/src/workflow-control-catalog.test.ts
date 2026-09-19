import { describe, expect, it } from 'vitest'
import { projectWorkflowExecutableTemplate } from './workflowActionCatalogProjection'

function fixture(kind: 'condition' | 'repeat_until') {
  const uuid = '20000000-0000-4000-8000-000000000001'
  const resourceTemplateUuid = '10000000-0000-4000-8000-000000000001'
  return {
    summary: { uuid, resourceTemplateUuid, name: kind, displayName: kind, actionType: kind, nodeType: kind },
    data: { template: { uuid, resource_template_uuid: resourceTemplateUuid, name: kind,
      display_name: kind, type: kind, node_type: kind,
      class: `unilabos.workflow.authoring:${kind}`, schema: null,
      goal: {}, goal_default: {}, meta_data: { unilab: {
        framework_owner_only: true, executor_kind: kind,
        parameter_schema: { type: 'object', properties: {} }
      } } }, handles: [] }
  }
}
describe('framework control catalog', () => {
  it.each(['condition', 'repeat_until'] as const)('retains the authority contract for %s', kind => {
    const { summary, data } = fixture(kind)
    expect(projectWorkflowExecutableTemplate(summary, data)).toMatchObject({
      uuid: summary.uuid, nodeType: kind, actionType: kind,
      actionClass: data.template.class, schema: data.template.meta_data.unilab.parameter_schema,
      wireValue: data.template
    })
  })
  it('rejects a control template without framework ownership', () => {
    const { summary, data } = fixture('condition')
    data.template.meta_data.unilab.framework_owner_only = false
    expect(() => projectWorkflowExecutableTemplate(summary, data)).toThrow()
  })
})
