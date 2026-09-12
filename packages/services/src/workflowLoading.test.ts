import { describe, expect, it } from 'vitest'
import { readWorkflowLoadingRequest } from './workflowLoading'
import type { WorkflowIntervention } from './workflowInterventions'

const loading = { schema_version: 1, request_uuid: 'request', revision: 1, rows: [{ key: 'row',
  instrument: { id: 'instrument', label: '任意仪器' }, site: { id: 'site', label: '目标位' },
  material: { identity: 'planned', label: '容器', templateId: 'template' },
  quantity: 1, unit: '块', availability: { allowed: true } }] }
const item = (value: unknown): WorkflowIntervention => ({ uuid: 'i', workflow_task_uuid: 't', workflow_node_job_uuid: 'j',
  revision: 1, status: 'open', delivery_status: 'none', options: [{ id: 'confirm_loading' }], meta_data: { loading: value } })

describe('public loading snapshot', () => {
  it('preserves authoritative references and planned identity without fabricating stock', () => {
    expect(readWorkflowLoadingRequest(item(loading))).toEqual({ kind: 'ready', request: loading })
  })
  it.each([
    undefined, null, { ...loading, schema_version: 2 }, { ...loading, revision: 1.5 },
    { ...loading, rows: [...loading.rows, ...loading.rows] },
    { ...loading, rows: [{ ...loading.rows[0], material: { identity: 'planned', id: 'fake', label: '容器' } }] },
    { ...loading, rows: [{ ...loading.rows[0], material: { identity: 'existing', label: '容器' } }] },
    { ...loading, rows: [{ ...loading.rows[0], quantity: -1 }] }
  ])('fails closed on incompatible loading data %#', value => {
    expect(readWorkflowLoadingRequest(item(value)).kind).toBe('invalid')
  })
  it('does not mistake an ordinary intervention for loading', () => {
    expect(readWorkflowLoadingRequest({ ...item(undefined), options: [{ id: 'retry' }], meta_data: {} })).toEqual({ kind: 'absent' })
  })
})
