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
  if (condition.lit === true || condition.lit === false) {
    return { variable: '', operator: 'truthy', value: '' }
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
  // 允许用户直接在默认的“固定为真/假”表单中输入参数名；
  // 一旦有参数名，自动切换为参数真值判断，避免受控输入每次按键都被清空。
  if (operator === 'literal_true') return variable ? { var: variable } : { lit: true }
  if (operator === 'literal_false') return variable ? { var: variable } : { lit: false }
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
                disabled={!editable || editor.branches.length <= 2}
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
              <span>这个分支已连接的节点</span>
              <div className="workflow-condition-editor__connected-members">
                {branch.node_uuids.length > 0
                  ? branch.node_uuids.map((uuid) => {
                      const candidate = editor.candidateNodes.find(item => item.uuid === uuid)
                      return <span key={uuid}>{candidate?.name ?? uuid}</span>
                    })
                  : <small>尚未连接节点，请从分支 handle 连接动作节点。</small>}
              </div>
              <small>此处只展示已连接到当前分支 handle 的节点。</small>
            </label>
          </article>
        )
      })}
    </section>
  )
}
