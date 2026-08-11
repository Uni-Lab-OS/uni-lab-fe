import {
  boundedMaterialTypeDraftInteger,
  CompatibleContent,
  CompatibleSite,
  containerKindLabel,
  containerPositionLabel,
  CONTENT_OPTIONS,
  MaterialContainerLayout,
  MaterialContainerNaming,
  MaterialTypeBasicDraft,
  MaterialTypeDraftField,
  MaterialTypeDraftFieldType,
  materialTypeDraftFieldKeyIssue,
  MaterialTypeDraftGridPreview,
  MaterialTypeDraftPreviewControl,
  MaterialTypeDraftStepHeader,
  selectedMaterialTypeDraftLabels,
  SITE_OPTIONS
} from './materialTypeDraftModel'

/**
 * 渲染自定义资源模板的基本信息步骤。
 *
 * @param props 名称种子与步骤标题焦点引用。
 * @returns 资源模板身份信息表单。
 */
export function MaterialTypeBasicStep({
  draft,
  titleRef,
  onChange
}: {
  draft: MaterialTypeBasicDraft
  titleRef: React.Ref<HTMLHeadingElement>
  onChange: (patch: Partial<MaterialTypeBasicDraft>) => void
}): React.JSX.Element {
  return (
    <section className="material-type-draft__step" aria-labelledby="material-type-basic-title">
      <MaterialTypeDraftStepHeader
        titleRef={titleRef}
        id="material-type-basic-title"
        eyebrow="步骤 1 · 类型身份"
        title="基本信息"
        detail="定义用户在资源模板目录中识别和检索该物料类型所需的信息。"
        badge="资源模板"
      />
      <div className="material-type-draft__field-grid">
        <label>
          类型名称 <em>必填</em>
          <input
            autoFocus
            value={draft.name}
            placeholder="例如：96 孔 PCR 板"
            onChange={(event) => onChange({ name: event.target.value })}
          />
        </label>
        <label>
          类型分类 <em>必填</em>
          <select
            value={draft.category}
            onChange={(event) => onChange({
              category: event.target.value as MaterialTypeBasicDraft['category']
            })}
          >
            <option value="consumable">耗材</option>
            <option value="container">容器</option>
            <option value="sample">样品</option>
            <option value="other">其他</option>
          </select>
        </label>
        <label className="is-wide">
          类型说明
          <textarea
            value={draft.description}
            placeholder="说明用途、规格和识别方式"
            rows={4}
            onChange={(event) => onChange({ description: event.target.value })}
          />
        </label>
        <label>
          厂商型号（可选）
          <input
            value={draft.manufacturerModel}
            placeholder="例如：PCR-96-LP"
            onChange={(event) => onChange({ manufacturerModel: event.target.value })}
          />
        </label>
        <label>
          默认计量单位
          <select
            value={draft.unit}
            onChange={(event) => onChange({
              unit: event.target.value as MaterialTypeBasicDraft['unit']
            })}
          >
            <option value="piece">件</option>
            <option value="mL">mL</option>
            <option value="g">g</option>
          </select>
        </label>
      </div>
      <div className="material-type-draft__step-help">
        <strong>接下来：定义实例字段</strong>
        <p>类型保存后，每个由它创建的具体物料实例都会继承下一步定义的编辑表单。</p>
      </div>
    </section>
  )
}

/**
 * 渲染实例字段编辑器及结构化实例表单预览。
 *
 * @param props 字段草稿、增删改回调与标题焦点引用。
 * @returns 只修改本地 ResourceTemplate 草稿的字段设计页面。
 */
export function MaterialTypeFieldsStep({
  fields,
  titleRef,
  onAddField,
  onUpdateField,
  onRemoveField
}: {
  fields: ReadonlyArray<MaterialTypeDraftField>
  titleRef: React.Ref<HTMLHeadingElement>
  onAddField: () => void
  onUpdateField: (
    fieldId: number,
    patch: Partial<Omit<MaterialTypeDraftField, 'id'>>
  ) => void
  onRemoveField: (fieldId: number) => void
}): React.JSX.Element {
  return (
    <section className="material-type-draft__step" aria-labelledby="material-type-fields-title">
      <MaterialTypeDraftStepHeader
        titleRef={titleRef}
        id="material-type-fields-title"
        eyebrow="步骤 2 · 实例配置"
        title="实例字段"
        detail="设计每个具体物料实例的结构化配置表单，用户无需编辑 JSON。"
        action={<button type="button" onClick={onAddField}>＋ 添加字段</button>}
      />
      <div className="material-type-draft__split">
        <div className="material-type-draft__field-editor">
          <div className="material-type-draft__column-labels" aria-hidden="true">
            <span>字段定义</span><span>{fields.length} 项</span>
          </div>
          {fields.map((field, index) => {
            const keyIssue = materialTypeDraftFieldKeyIssue(field, fields)
            return (
              <article key={field.id} className="material-type-draft__field-card">
                <header>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <strong>{field.name || '未命名字段'}</strong>
                  <button
                    type="button"
                    aria-label={`删除${field.name || `字段 ${index + 1}`}`}
                    onClick={() => onRemoveField(field.id)}
                  >
                    删除
                  </button>
                </header>
                <div className="material-type-draft__field-card-grid">
                  <label>
                    显示名称
                    <input
                      aria-label={`字段 ${index + 1} 名称`}
                      value={field.name}
                      onChange={(event) => onUpdateField(field.id, { name: event.target.value })}
                    />
                  </label>
                  <label data-invalid={Boolean(keyIssue)}>
                    配置键
                    <input
                      aria-label={`字段 ${index + 1} 配置键`}
                      value={field.key}
                      aria-invalid={Boolean(keyIssue)}
                      onChange={(event) => onUpdateField(field.id, { key: event.target.value })}
                    />
                    {keyIssue ? <small role="alert">{keyIssue}</small> : null}
                  </label>
                  <label>
                    数据类型
                    <select
                      aria-label={`字段 ${index + 1} 类型`}
                      value={field.type}
                      onChange={(event) => onUpdateField(field.id, {
                        type: event.target.value as MaterialTypeDraftFieldType,
                        defaultValue: ''
                      })}
                    >
                      <option value="text">文本</option>
                      <option value="date">日期</option>
                      <option value="number">数值</option>
                      <option value="boolean">是 / 否</option>
                      <option value="select">单选项</option>
                    </select>
                  </label>
                  <label>
                    默认值
                    <input
                      aria-label={`字段 ${index + 1} 默认值`}
                      value={field.defaultValue}
                      placeholder="不设置"
                      onChange={(event) => onUpdateField(field.id, {
                        defaultValue: event.target.value
                      })}
                    />
                  </label>
                  <label className="is-description">
                    字段说明
                    <input
                      aria-label={`字段 ${index + 1} 说明`}
                      value={field.description}
                      placeholder="告诉用户如何填写"
                      onChange={(event) => onUpdateField(field.id, {
                        description: event.target.value
                      })}
                    />
                  </label>
                  <label className="material-type-draft__required">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => onUpdateField(field.id, {
                        required: event.target.checked
                      })}
                    />
                    创建实例时必填
                  </label>
                </div>
              </article>
            )
          })}
        </div>
        <aside className="material-type-draft__preview" aria-label="实例配置表单预览">
          <header><span>实例编辑预览</span><small>结构化配置</small></header>
          <div>
            <strong>96 孔 PCR 板 · PCR-001</strong>
            <p>字段将以当前顺序出现在实例属性侧栏中。</p>
          </div>
          {fields.length > 0 ? fields.map((field) => (
            <label key={field.id}>
              {field.name || '未命名字段'} {field.required ? <em>必填</em> : <small>可选</small>}
              <MaterialTypeDraftPreviewControl field={field} />
              <span>{field.description || `config.${field.key || '未定义'}`}</span>
            </label>
          )) : (
            <div className="material-type-draft__empty-preview">当前类型没有实例专属字段</div>
          )}
        </aside>
      </div>
    </section>
  )
}

/**
 * 渲染内部容器结构选择、网格参数与位置预览。
 *
 * @param props 本地结构草稿与更新回调。
 * @returns 不创建子物料实例的 ResourceTemplate 结构页面。
 */
export function MaterialTypeLayoutStep({
  layout,
  rows,
  columns,
  containerKind,
  naming,
  titleRef,
  onLayoutChange,
  onRowsChange,
  onColumnsChange,
  onContainerKindChange,
  onNamingChange
}: {
  layout: MaterialContainerLayout
  rows: number
  columns: number
  containerKind: string
  naming: MaterialContainerNaming
  titleRef: React.Ref<HTMLHeadingElement>
  onLayoutChange: (layout: MaterialContainerLayout) => void
  onRowsChange: (rows: number) => void
  onColumnsChange: (columns: number) => void
  onContainerKindChange: (kind: string) => void
  onNamingChange: (naming: MaterialContainerNaming) => void
}): React.JSX.Element {
  return (
    <section className="material-type-draft__step" aria-labelledby="material-type-layout-title">
      <MaterialTypeDraftStepHeader
        titleRef={titleRef}
        id="material-type-layout-title"
        eyebrow="步骤 3 · 内部结构"
        title="容器结构"
        detail="定义孔位或子容器位置的几何布局；这些位置属于资源模板结构，不是预先创建的空物料实例。"
        badge={layout === 'grid' ? `${rows * columns} 个位置` : '无内部位置'}
      />
      <div className="material-type-draft__choice-grid" role="radiogroup" aria-label="容器布局">
        <label data-selected={layout === 'none'}>
          <input type="radio" name="layout" checked={layout === 'none'} onChange={() => onLayoutChange('none')} />
          <span><strong>无内部结构</strong><small>普通耗材或单一容器</small></span>
        </label>
        <label data-selected={layout === 'grid'}>
          <input type="radio" name="layout" checked={layout === 'grid'} onChange={() => onLayoutChange('grid')} />
          <span><strong>规则网格</strong><small>孔板、枪头盒等行列阵列</small></span>
        </label>
        <label data-disabled="true">
          <input type="radio" name="layout" disabled />
          <span><strong>自定义点位</strong><small>待可视化点位编辑器接入</small></span>
        </label>
      </div>
      {layout === 'grid' ? (
        <div className="material-type-draft__layout-workspace">
          <div className="material-type-draft__layout-settings">
            <header><strong>网格参数</strong><small>规则阵列</small></header>
            <div>
              <label>行数
                <input aria-label="行数" type="number" min="1" max="26" value={rows}
                  onChange={(event) => onRowsChange(boundedMaterialTypeDraftInteger(event.target.value, 26))} />
              </label>
              <label>列数
                <input aria-label="列数" type="number" min="1" max="24" value={columns}
                  onChange={(event) => onColumnsChange(boundedMaterialTypeDraftInteger(event.target.value, 24))} />
              </label>
              <label>内部位置类型
                <select value={containerKind} onChange={(event) => onContainerKindChange(event.target.value)}>
                  <option value="well">孔位</option>
                  <option value="tip-spot">枪头位</option>
                  <option value="container">子容器位</option>
                </select>
              </label>
              <label>位置命名
                <select value={naming} onChange={(event) => onNamingChange(event.target.value as MaterialContainerNaming)}>
                  <option value="row-column">行字母 + 列号（A1）</option>
                  <option value="numeric">连续编号（01）</option>
                </select>
              </label>
            </div>
            <dl>
              <div><dt>总位置数</dt><dd>{rows * columns}</dd></div>
              <div><dt>结构类型</dt><dd>{containerKindLabel(containerKind)}</dd></div>
              <div><dt>示例名称</dt><dd>{containerPositionLabel(0, 0, columns, naming)}</dd></div>
            </dl>
          </div>
          <MaterialTypeDraftGridPreview rows={rows} columns={columns} naming={naming} />
        </div>
      ) : (
        <div className="material-type-draft__layout-empty">
          <span aria-hidden="true">◇</span>
          <div>
            <strong>该类型作为一个整体进行管理</strong>
            <p>创建实例时不会展开内部位置，也不会生成任何子物料实例。</p>
          </div>
        </div>
      )}
    </section>
  )
}

/**
 * 渲染可承载内容、可放入库位类型与 ResourceTemplate 草稿摘要。
 *
 * @param props 两类兼容规则的选中状态与切换回调。
 * @returns 不创建物料或库位占用的兼容规则页面。
 */
export function MaterialTypeCompatibilityStep({
  compatibleContents,
  compatibleSites,
  titleRef,
  onToggleContent,
  onToggleSite
}: {
  compatibleContents: Record<CompatibleContent, boolean>
  compatibleSites: Record<CompatibleSite, boolean>
  titleRef: React.Ref<HTMLHeadingElement>
  onToggleContent: (id: CompatibleContent) => void
  onToggleSite: (id: CompatibleSite) => void
}): React.JSX.Element {
  return (
    <section className="material-type-draft__step" aria-labelledby="material-type-compatibility-title">
      <MaterialTypeDraftStepHeader
        titleRef={titleRef}
        id="material-type-compatibility-title"
        eyebrow="步骤 4 · 运行边界"
        title="兼容规则"
        detail="分别声明该类型能够承载什么，以及它的实例允许被放入哪些稳定库位（Site）类型。"
        badge="模板规则"
      />
      <div className="material-type-draft__rules">
        <CompatibilityRuleFieldset
          index="01"
          title="允许承载的内容"
          detail="约束内部位置可接收的物料类型，不会自动创建这些物料。"
          options={CONTENT_OPTIONS}
          selected={compatibleContents}
          onToggle={onToggleContent}
        />
        <CompatibilityRuleFieldset
          index="02"
          title="允许放入的库位类型"
          detail="约束物料实例的可放置范围，实际位置仍通过库位占用命令记录。"
          options={SITE_OPTIONS}
          selected={compatibleSites}
          onToggle={onToggleSite}
        />
        <aside className="material-type-draft__rule-summary">
          <header><span>配置摘要</span><small>ResourceTemplate 草稿</small></header>
          <section>
            <small>允许承载</small>
            <div>{selectedMaterialTypeDraftLabels(CONTENT_OPTIONS, compatibleContents)}</div>
          </section>
          <section>
            <small>允许放入</small>
            <div>{selectedMaterialTypeDraftLabels(SITE_OPTIONS, compatibleSites)}</div>
          </section>
          <div className="material-type-draft__authority-boundary" role="note">
            <span aria-hidden="true">i</span>
            <p>保存模板只会定义兼容规则，不创建物料实例、不占用库位，也不产生任务物料预留或作业执行占用。</p>
          </div>
        </aside>
      </div>
    </section>
  )
}

/**
 * 渲染一组同类型的兼容规则选项。
 *
 * @param props 规则标题、说明、选项、选中状态与切换回调。
 * @returns 一组可访问的兼容规则复选框。
 */
function CompatibilityRuleFieldset<T extends string>({
  index,
  title,
  detail,
  options,
  selected,
  onToggle
}: {
  index: string
  title: string
  detail: string
  options: ReadonlyArray<{ id: T; label: string; detail: string }>
  selected: Record<T, boolean>
  onToggle: (id: T) => void
}): React.JSX.Element {
  return (
    <fieldset>
      <legend><span>{index}</span><strong>{title}</strong></legend>
      <p>{detail}</p>
      {options.map((option) => (
        <label key={option.id} data-selected={selected[option.id]}>
          <input type="checkbox" checked={selected[option.id]} onChange={() => onToggle(option.id)} />
          <span><strong>{option.label}</strong><small>{option.detail}</small></span>
        </label>
      ))}
    </fieldset>
  )
}
