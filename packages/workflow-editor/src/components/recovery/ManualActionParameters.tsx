import type { RecoveryActionSchema as ActionSchema } from '@unilab/services'
type MaterialRecord = { uuid: string; name: string; sourceNodeId?: string; resourceTemplateUuid?: string }

export interface ParameterizedAction {
  parameter_schema: ActionSchema
  defaults: Record<string, unknown>
}

export function parameterType(schema: ActionSchema): string {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  const type = types.find((item) => item && item !== 'null')
  if (type) return type
  return schema.anyOf?.find((item) => item.type !== 'null')?.type as string || 'string'
}

export function parameterDefaults(action: ParameterizedAction): Record<string, string> {
  const values = { ...Object.fromEntries(Object.entries(action.parameter_schema.properties || {})
    .filter(([, schema]) => schema.default !== undefined).map(([key, schema]) => [key, schema.default])), ...action.defaults }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)]))
}

/** 只处理输入格式；执行资格及完整 Schema 校验由 Edge 决定。 */
export function parseManualParameters(action: ParameterizedAction, drafts: Record<string, string>, raw: string, asJson = false): Record<string, unknown> {
  const properties = action.parameter_schema.properties
  if (asJson || !properties || !Object.keys(properties).length) {
    const value = JSON.parse(raw || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('动作参数必须是 JSON 对象')
    return value
  }
  const values: Record<string, unknown> = { ...action.defaults }
  for (const [name, schema] of Object.entries(properties)) {
    const text = drafts[name] ?? ''
    const label = schema.title || name
    if (text === '') {
      if (action.parameter_schema.required?.includes(name)) throw new Error(`请填写${label}`)
      delete values[name]
      continue
    }
    const type = parameterType(schema)
    let value: unknown = text
    if (type === 'integer' || type === 'number') {
      value = Number(text)
      if (!text.trim() || !Number.isFinite(value) || (type === 'integer' && !Number.isInteger(value))) throw new Error(`${label}必须是${type === 'integer' ? '整数' : '数字'}`)
      if (typeof schema.minimum === 'number' && Number(value) < schema.minimum) throw new Error(`${label}不能小于 ${schema.minimum}`)
      if (typeof schema.maximum === 'number' && Number(value) > schema.maximum) throw new Error(`${label}不能大于 ${schema.maximum}`)
    } else if (type === 'boolean') {
      if (!['true', 'false'].includes(text)) throw new Error(`${label}必须选择是或否`)
      value = text === 'true'
    } else if (type === 'object' || type === 'array') {
      try { value = JSON.parse(text) } catch { throw new Error(`${label}的 JSON 格式不正确`) }
      if (type === 'array' ? !Array.isArray(value) : !value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label}必须是${type === 'array' ? '数组' : '对象'}`)
    }
    if (schema.enum && !schema.enum.some((item) => JSON.stringify(item) === JSON.stringify(value))) throw new Error(`${label}不在可选值中`)
    values[name] = value
  }
  return values
}

function selectedMaterialUuid(value: string): string {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && typeof parsed.uuid === 'string' ? parsed.uuid : ''
  } catch {
    return ''
  }
}

function materialCandidates(schema: ActionSchema, materials: MaterialRecord[]): MaterialRecord[] {
  const allowed = Array.isArray(schema.allowed_resource_template_uuids)
    ? schema.allowed_resource_template_uuids.map(String)
    : undefined
  return materials.filter((material) => allowed === undefined || Boolean(
    material.resourceTemplateUuid && allowed.includes(material.resourceTemplateUuid),
  ))
}

export function ManualActionParameters({ action, drafts, raw, disabled, onDraft, onRaw, asJson = false, materials }: {
  action: ParameterizedAction
  drafts: Record<string, string>
  raw: string
  disabled: boolean
  onDraft: (key: string, value: string) => void
  onRaw: (value: string) => void
  asJson?: boolean
  materials?: MaterialRecord[]
}) {
  const properties = Object.entries(action.parameter_schema.properties || {})
  if (asJson || !properties.length) return <label className="form-field"><span>动作参数（JSON 对象）</span><textarea rows={4} disabled={disabled} value={raw} onChange={(event) => onRaw(event.target.value)} /></label>
  return <div className="action-parameter-grid handling-parameter-grid">{properties.map(([name, schema]) => {
    const type = parameterType(schema)
    const choices = schema.enum || (type === 'boolean' ? [true, false] : undefined)
    const label = schema.title || name
    const isMaterial = typeof schema['x-unilabos-material-lock'] === 'boolean' || schema.$slot === 'ResourceSlot'
    const candidates = isMaterial && materials ? materialCandidates(schema, materials) : []
    return <label className="form-field" key={name}>
      <span>{label}{action.parameter_schema.required?.includes(name) ? ' *' : ''}</span>
      {isMaterial && materials ? <select aria-label={label} value={selectedMaterialUuid(drafts[name] ?? '')} disabled={disabled} onChange={(event) => onDraft(name, event.target.value ? JSON.stringify({ uuid: event.target.value }) : '')}>
        <option value="">请选择物料</option>{candidates.map((material) => <option key={material.uuid} value={material.uuid}>{material.name} · {material.sourceNodeId || material.uuid.slice(0, 8)}</option>)}
      </select> : choices ? <select aria-label={label} value={drafts[name] ?? ''} disabled={disabled} onChange={(event) => onDraft(name, event.target.value)}>
        <option value="">请选择</option>{choices.map((value, index) => <option key={index} value={typeof value === 'string' ? value : JSON.stringify(value)}>{typeof value === 'boolean' ? value ? '是' : '否' : String(value)}</option>)}
      </select> : type === 'array' || type === 'object' ? <textarea aria-label={label} rows={3} value={drafts[name] ?? ''} disabled={disabled} onChange={(event) => onDraft(name, event.target.value)} />
        : <input aria-label={label} type={type === 'integer' || type === 'number' ? 'number' : 'text'} step={type === 'integer' ? 1 : 'any'} min={schema.minimum} max={schema.maximum} value={drafts[name] ?? ''} disabled={disabled} onChange={(event) => onDraft(name, event.target.value)} />}
      <small>{name} · {type}{schema.description ? ` · ${schema.description}` : ''}</small>
    </label>
  })}</div>
}
