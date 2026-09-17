import type { WorkflowAuthoringGraph } from '@unilab/services'

import {
  addWorkflowConditionBranch,
  projectWorkflowConditionEditor,
  removeWorkflowConditionBranch,
  updateWorkflowConditionBranch,
  updateWorkflowConditionParam,
  type WorkflowConditionBranch
} from '../utils/workflowConditionControl'

function conditionForm(condition: Record<string, unknown> | null): {
  variable: string
  operator: string
  value: string
} {
  if (!condition) return { variable: '', operator: 'truthy', value: '' }
  if (condition.lit === true) {
    return { variable: '', operator: 'literal_true', value: '' }
  }
  if (condition.lit === false) {
    return { variable: '', operator: 'literal_false', value: '' }
  }
  if (typeof condition.var === 'string') {
    return { variable: condition.var, operator: 'truthy', value: '' }
  }
  if (typeof condition.binop === 'string') {
    const left = condition.left && typeof condition.left === 'object'
      ? condition.left as Record<string, unknown> : {}
    const right = condition.right && typeof condition.right === 'object'
      ? condition.right as Record<string, unknown> : {}
    return {
      variable: typeof left.var === 'string' ? left.var : '',
      operator: condition.binop,
      value: Object.prototype.hasOwnProperty.call(right, 'lit')
        ? JSON.stringify(right.lit) : ''
    }
  }
  return { variable: '', operator: 'truthy', value: '' }
}

function literal(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ''
  try { return JSON.parse(value) } catch { return raw }
}

function buildCondition(variable: string, operator: string, value: string): Record<string, unknown> {
  if (operator === 'literal_true') return { lit: true }
  if (operator === 'literal_false') return { lit: false }
  if (operator === 'truthy') return variable ? { var: variable } : { lit: true }
  return {
    binop: operator,
    left: { var: variable || 'value' },
    right: { lit: literal(value) }
  }
}

export function WorkflowConditionNodeEditor({
  graph,
  nodeUuid,
  editable,
  onChange
}: {
  graph: WorkflowAuthoringGraph
  nodeUuid: string
  editable: boolean
  onChange(param: Record<string, unknown>): void
}): React.JSX.Element {
  const editor = projectWorkflowConditionEditor(graph, nodeUuid)
  const node = graph.nodes.find((item) => item.uuid === nodeUuid)!
  const commit = (branches: WorkflowConditionBranch[]): void => {
    onChange(updateWorkflowConditionParam(node.param, branches))
  }

  return (
    <section className="workflow-condition-editor" aria-label="条件分支配置">
      <header>
        <span><strong>条件分支</strong><small>严格布尔 · 只执行首个命中分支</small></span>
        <button type="button" disabled={!editable} onClick={() => commit(
          addWorkflowConditionBranch(editor.branches)
        )}>＋ 添加分支</button>
      </header>
      {editor.branches.map((branch, index) => {
        const fallback = index === editor.branches.length - 1
        const form = conditionForm(branch.condition)
        return (
          <article key={`${nodeUuid}:branch:${index}`}>
            <div className="workflow-condition-editor__branch-heading">
              <b>{index + 1}</b>
              <strong>{branch.label} · {fallback ? '兜底分支' : '判断分支'}</strong>
              <button type="button" aria-label={`删除条件分支 ${index + 1}`}
                disabled={!editable || editor.branches.length <= 1}
                onClick={() => commit(removeWorkflowConditionBranch(editor.branches, index))}>×</button>
            </div>
            {!fallback ? (
              <div className="workflow-condition-editor__condition">
                <label><span>参数名</span><input value={form.variable} disabled={!editable}
                  placeholder="例如 qualified"
                  onChange={event => commit(updateWorkflowConditionBranch(editor.branches, index, {
                    condition: buildCondition(event.target.value, form.operator, form.value)
                  }))} /></label>
                <label><span>判断方式</span><select value={form.operator} disabled={!editable}
                  onChange={event => commit(updateWorkflowConditionBranch(editor.branches, index, {
                    condition: buildCondition(form.variable, event.target.value, form.value)
                  }))}>
                  <option value="literal_true">固定为真（测试）</option>
                  <option value="literal_false">固定为假（测试）</option>
                  <option value="truthy">参数为真</option><option value="==">等于</option>
                  <option value="!=">不等于</option><option value=">">大于</option>
                  <option value=">=">大于等于</option><option value="<">小于</option>
                  <option value="<=">小于等于</option>
                </select></label>
                {form.operator !== 'truthy' && <label><span>比较值</span><input value={form.value}
                  disabled={!editable} placeholder="true、数字或文本"
                  onChange={event => commit(updateWorkflowConditionBranch(editor.branches, index, {
                    condition: buildCondition(form.variable, form.operator, event.target.value)
                  }))} /></label>}
              </div>
            ) : <p>前面的条件均不满足时执行。</p>}
            <label className="workflow-condition-editor__members">
              <span>这个分支执行哪些节点</span>
              <select multiple value={branch.node_uuids} disabled={!editable}
                onChange={event => commit(updateWorkflowConditionBranch(editor.branches, index, {
                  node_uuids: [...event.target.selectedOptions].map(option => option.value)
                }))}>
                {editor.candidateNodes.map(candidate => (
                  <option key={candidate.uuid} value={candidate.uuid}>{candidate.name}</option>
                ))}
              </select>
              <small>按住 Ctrl/⌘ 可多选；首尾节点自动成为分支入口和出口。</small>
            </label>
          </article>
        )
      })}
    </section>
  )
}
