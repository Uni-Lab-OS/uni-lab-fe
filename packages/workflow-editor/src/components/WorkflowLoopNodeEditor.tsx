import type { WorkflowAuthoringGraph } from '@unilab/services'

import {
  projectWorkflowLoopEditor,
  updateWorkflowLoopParam
} from '../utils/workflowLoopControl'


function loopUntilForm(condition: Record<string, unknown>): {
  variable: string
  operator: string
  value: string
} {
  if (condition.lit === true) return { variable: '', operator: 'literal_true', value: '' }
  if (condition.lit === false) return { variable: '', operator: 'literal_false', value: '' }
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
  return { variable: '', operator: 'literal_true', value: '' }
}

function loopUntilLiteral(raw: string): unknown {
  const value = raw.trim()
  if (!value) return ''
  try { return JSON.parse(value) } catch { return raw }
}

function buildLoopUntil(variable: string, operator: string, value: string): Record<string, unknown> {
  if (operator === 'literal_true') return { lit: true }
  if (operator === 'literal_false') return { lit: false }
  if (operator === 'truthy') return { var: variable || 'done' }
  return {
    binop: operator,
    left: { var: variable || 'done' },
    right: { lit: loopUntilLiteral(value) }
  }
}
/** Dify Loop 风格的循环编排编辑器：配置循环变量、最大轮次、循环体与退出后继。 */
export function WorkflowLoopNodeEditor({
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
  const editor = projectWorkflowLoopEditor(graph, nodeUuid)
  const until = loopUntilForm(editor.until)
  const commit = (patch: Parameters<typeof updateWorkflowLoopParam>[1]): void => {
    onChange(updateWorkflowLoopParam(graph.nodes.find(n => n.uuid === nodeUuid)?.param, patch))
  }
  const selected = (event: React.ChangeEvent<HTMLSelectElement>): string[] =>
    [...event.target.selectedOptions].map(option => option.value)

  return (
    <section className="workflow-loop-editor" aria-label="循环编排配置">
      <header>
        <span><strong>循环编排</strong><small>最多轮次内重复执行循环体，满足条件后退出</small></span>
      </header>
      <div className="workflow-loop-editor__grid">
        <label className="workflow-loop-editor__field">
          <span>循环变量名</span>
          <input value={editor.loopVariable} disabled={!editable}
            onChange={event => commit({ loopVariable: event.target.value })} />
        </label>
        <label className="workflow-loop-editor__field">
          <span>最多循环次数</span>
          <input type="number" min={1} value={editor.maxIterations} disabled={!editable}
            onChange={event => commit({ maxIterations: Number(event.target.value) || 1 })} />
        </label>
      </div>
      <fieldset className="workflow-loop-editor__until">
        <legend>循环终止条件</legend>
        <small>每轮循环体执行完毕后判断；条件满足时终止循环。</small>
        <div className="workflow-loop-editor__grid">
          <label className="workflow-loop-editor__field">
            <span>判断方式</span>
            <select value={until.operator} disabled={!editable}
              onChange={event => commit({
                until: buildLoopUntil(until.variable, event.target.value, until.value)
              })}>
              <option value="literal_true">固定为真（测试）</option>
              <option value="literal_false">固定为假（测试）</option>
              <option value="truthy">参数为真</option>
              <option value="==">等于</option><option value="!=">不等于</option>
              <option value=">">大于</option><option value=">=">大于等于</option>
              <option value="<">小于</option><option value="<=">小于等于</option>
            </select>
          </label>
          {!until.operator.startsWith('literal_') && (
            <label className="workflow-loop-editor__field">
              <span>参数名</span>
              <input value={until.variable} disabled={!editable} placeholder="例如 done"
                onChange={event => commit({
                  until: buildLoopUntil(event.target.value, until.operator, until.value)
                })} />
            </label>
          )}
        </div>
        {!until.operator.startsWith('literal_') && until.operator !== 'truthy' && (
          <label className="workflow-loop-editor__field">
            <span>比较值</span>
            <input value={until.value} disabled={!editable} placeholder="true、数字或文本"
              onChange={event => commit({
                until: buildLoopUntil(until.variable, until.operator, event.target.value)
              })} />
          </label>
        )}
      </fieldset>
      <label className="workflow-loop-editor__members">
        <span>循环体执行节点</span>
        <select multiple value={editor.bodyNodeUuids} disabled={!editable}
          onChange={event => commit({ bodyNodeUuids: selected(event) })}>
          {editor.candidateNodes.map(candidate => (
            <option key={candidate.uuid} value={candidate.uuid}>{candidate.name}</option>
          ))}
        </select>
        <small>按住 Ctrl/⌘ 可多选；首尾节点自动成为循环入口和出口。</small>
      </label>
      <label className="workflow-loop-editor__members">
        <span>循环完成后的后继节点（可选）</span>
        <select multiple value={editor.successorNodeUuids} disabled={!editable}
          onChange={event => commit({ successorNodeUuids: selected(event) })}>
          {editor.candidateNodes.map(candidate => (
            <option key={candidate.uuid} value={candidate.uuid}>{candidate.name}</option>
          ))}
        </select>
        <small>满足退出条件后按选择顺序继续执行。</small>
      </label>
    </section>
  )
}
