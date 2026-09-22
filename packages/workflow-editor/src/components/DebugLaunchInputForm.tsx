import type { DebugLaunchRequirementReason } from '@unilab/services'

import type {
  DebugLaunchInputFieldState,
  DebugLaunchInputFormState
} from '../utils/debugLaunchInputForm'
import { WorkflowButton } from './WorkflowButton'

interface DebugLaunchInputFormProps {
  form: DebugLaunchInputFormState
  busy?: boolean
  problem?: string | null
  onChange: (
    requirementId: string,
    next: Pick<DebugLaunchInputFieldState, 'valueText' | 'confirmed'>
  ) => void
  onSubmit?: () => void
  onCancel?: () => void
}

export function DebugLaunchInputForm({
  form,
  busy = false,
  problem = null,
  onChange,
  onSubmit,
  onCancel
}: DebugLaunchInputFormProps): React.JSX.Element {
  return (
    <section
      className="workflow-task-input-form debug-launch-input-form"
      aria-label="调试启动缺失输入引导"
    >
      <header>
        <div>
          <strong>补充被跳过节点的输入</strong>
          <span>运行预检</span>
        </div>
        <p>
          起始点或禁用节点裁掉了上游值。补充值只冻结到本次调试任务，
          不写回工作流，也不会改写库存。
        </p>
      </header>

      {problem && <p className="workflow-runtime__problem" role="alert">{problem}</p>}
      {form.preflight.diagnostics.map((diagnostic) => (
        <p key={`${diagnostic.code}:${diagnostic.requirement_id ?? ''}`} role="alert">
          {diagnostic.message}
        </p>
      ))}

      <ol>
        {form.fields.map(({ requirement, valueText, confirmed }) => (
          <li key={requirement.id} data-debug-launch-requirement={requirement.id}>
            <div className="workflow-task-input-form__identity">
              <div className="workflow-task-input-form__heading">
                <strong>{requirement.target.node_name}</strong>
                <code>{requirement.target.display_name}</code>
                <span>{reasonLabel(requirement.reason)}</span>
              </div>
              {requirement.upstream_nodes.length > 0 && (
                <p>
                  被跳过的上游：{requirement.upstream_nodes
                    .map(({ node_name: name }) => name).join('、')}
                </p>
              )}
            </div>

            <div className="workflow-task-input-form__default">
              <p>目标参数：<code>{requirement.target.data_key}</code></p>
              <p>Schema：<code>{JSON.stringify(requirement.schema)}</code></p>
            </div>

            <div className="workflow-task-input-form__control">
              {requirement.kind === 'material' ? (
                <>
                  <label>
                    当前实验室兼容物料
                    <select
                      aria-label={`${requirement.target.node_name} 兼容物料`}
                      value={valueText}
                      disabled={busy}
                      onChange={(event) => onChange(requirement.id, {
                        valueText: event.target.value,
                        confirmed: false
                      })}
                    >
                      <option value="">请选择物料</option>
                      {requirement.suggestions.map((suggestion) => (
                        <option
                          key={suggestion.id}
                          value={suggestion.material_uuid}
                        >
                          {suggestion.recommended ? '建议 · ' : ''}
                          {suggestion.material_name} · {suggestion.material_uuid}
                        </option>
                      ))}
                    </select>
                  </label>
                  {requirement.suggestions.map((suggestion) =>
                    suggestion.material_uuid === valueText && (
                      <div key={suggestion.id} className="debug-launch-input-form__material-fact">
                        <strong>Inventory Authority 当前事实</strong>
                        <dl>
                          <dt>Material UUID</dt><dd><code>{suggestion.material_uuid}</code></dd>
                          <dt>模板</dt><dd><code>{suggestion.resource_template_uuid}</code></dd>
                          <dt>实际 Site</dt>
                          <dd>
                            {suggestion.actual.site
                              ? `${suggestion.actual.site.name} (${suggestion.actual.site.uuid})`
                              : '未占用 Site'}
                          </dd>
                          <dt>实际状态</dt><dd>{suggestion.actual.status ?? '未记录'}</dd>
                        </dl>
                        {suggestion.inferred_target.kind === 'same_material_passthrough' && (
                          <p>
                            <strong>推断建议：</strong>
                            显式 passthrough 仅证明是同一物料；跳过操作后的目标
                            Site/状态未被库存事实证明，系统不会替你改写。
                          </p>
                        )}
                      </div>
                    )
                  )}
                  <label className="debug-launch-input-form__confirmation">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy || !valueText}
                      onChange={(event) => onChange(requirement.id, {
                        valueText,
                        confirmed: event.target.checked
                      })}
                    />
                    我已核对当前物料事实，并确认把该 UUID 作为本次调试输入
                  </label>
                </>
              ) : (
                <label>
                  本次补充值（JSON）
                  <textarea
                    aria-label={`${requirement.target.node_name} ${requirement.target.display_name} 补充值`}
                    value={valueText}
                    disabled={busy}
                    placeholder={'例如：7、true、"文本" 或 {"key":"value"}'}
                    onChange={(event) => onChange(requirement.id, {
                      valueText: event.target.value,
                      confirmed: false
                    })}
                  />
                </label>
              )}
            </div>
          </li>
        ))}
      </ol>

      {(onSubmit || onCancel) && (
        <footer>
          {onCancel && (
            <WorkflowButton
              type="button"
              disabled={busy}
              disabledReason="OS 正在预检调试输入"
              onClick={onCancel}
            >
              返回
            </WorkflowButton>
          )}
          {onSubmit && (
            <WorkflowButton
              type="button"
              className="workflow-runtime__primary"
              disabled={busy}
              disabledReason="OS 正在预检调试输入"
              onClick={onSubmit}
            >
              {busy ? '正在重新预检…' : '确认补充并启动调试'}
            </WorkflowButton>
          )}
        </footer>
      )}
    </section>
  )
}

function reasonLabel(reason: DebugLaunchRequirementReason): string {
  if (reason === 'disabled_node') return '上游已禁用'
  if (reason === 'out_of_scope') return '支路不在范围内'
  return '起始点裁剪'
}
