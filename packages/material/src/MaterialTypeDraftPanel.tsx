import { useRef, useState } from 'react'

import { materialScopeClassName } from './materialStyles'
import {
  CompatibleContent,
  CompatibleSite,
  MaterialContainerLayout,
  MaterialContainerNaming,
  MaterialTypeBasicDraft,
  MaterialTypeDraftField,
  MaterialTypeDraftStep
} from './materialTypeDraftModel'
import {
  MaterialTypeBasicStep,
  MaterialTypeCompatibilityStep,
  MaterialTypeFieldsStep,
  MaterialTypeLayoutStep
} from './MaterialTypeDraftSteps'

const DRAFT_STEPS: ReadonlyArray<{
  id: MaterialTypeDraftStep
  label: string
  hint: string
}> = [
  { id: 'basic', label: '基本信息', hint: '类型身份' },
  { id: 'fields', label: '实例字段', hint: '2 个字段' },
  { id: 'layout', label: '容器结构', hint: '96 个位置' },
  { id: 'compatibility', label: '兼容规则', hint: '承载与库位' }
]

/**
 * 展示自定义资源模板（ResourceTemplate）的四步结构化创建交互。
 *
 * @param seedName 可选的模板名称种子，只用于预填基本信息。
 * @param onClose 关闭向导的回调，不写入资源模板或物料权威数据。
 * @returns 可分步预览但关闭失败的自定义物料类型向导。
 *
 * 权威约束：当前前端服务没有资源模板写入命令；所有操作仅修改本地草稿，
 * 不创建物料（Material）、不修改库位占用（SiteOccupancy），也不产生任务预留。
 */
export function MaterialTypeDraftPanel({
  seedName,
  onClose
}: {
  seedName?: string
  onClose: () => void
}): React.JSX.Element {
  const stepTitleRef = useRef<HTMLHeadingElement>(null)
  const nextFieldId = useRef(3)
  const [activeStep, setActiveStep] = useState<MaterialTypeDraftStep>('basic')
  const [basicDraft, setBasicDraft] = useState<MaterialTypeBasicDraft>(() => ({
    name: seedName ? `${seedName} 副本` : '96 孔 PCR 板',
    category: 'container',
    description: '适用于常规 PCR、样品制备和自动化移液流程的 96 孔板。',
    manufacturerModel: 'PCR-96-LP',
    unit: 'piece'
  }))
  const [visitedSteps, setVisitedSteps] = useState<ReadonlySet<MaterialTypeDraftStep>>(
    () => new Set<MaterialTypeDraftStep>(['basic'])
  )
  const [layout, setLayout] = useState<MaterialContainerLayout>('grid')
  const [rows, setRows] = useState(8)
  const [columns, setColumns] = useState(12)
  const [containerKind, setContainerKind] = useState('well')
  const [naming, setNaming] = useState<MaterialContainerNaming>('row-column')
  const [fields, setFields] = useState<MaterialTypeDraftField[]>([
    {
      id: 1,
      name: '批次号',
      key: 'batch',
      type: 'text',
      required: false,
      defaultValue: '',
      description: '用于追溯同一生产或采购批次'
    },
    {
      id: 2,
      name: '有效期',
      key: 'expiresAt',
      type: 'date',
      required: false,
      defaultValue: '',
      description: '当前物料实例的失效日期'
    }
  ])
  const [compatibleContents, setCompatibleContents] = useState<
    Record<CompatibleContent, boolean>
  >({ reagent: true, sample: true, consumable: false, container: false })
  const [compatibleSites, setCompatibleSites] = useState<
    Record<CompatibleSite, boolean>
  >({ 'deck-slot': true, 'storage-rack': true, 'cold-storage': false, custom: false })

  const activeStepIndex = DRAFT_STEPS.findIndex((step) => step.id === activeStep)

  /**
   * 切换到指定的向导步骤并将阅读焦点移到新步骤标题。
   *
   * @param step 目标配置步骤。
   * @returns 无返回值；只修改本地草稿的页面状态。
   */
  const goToStep = (step: MaterialTypeDraftStep): void => {
    setActiveStep(step)
    setVisitedSteps((current) => new Set([...current, step]))
    globalThis.setTimeout(() => stepTitleRef.current?.focus(), 0)
  }

  /**
   * 合并一个实例字段的草稿属性。
   *
   * @param fieldId 本地草稿字段标识。
   * @param patch 需要修改的字段属性。
   * @returns 无返回值；不会写入资源模板权威数据。
   */
  const updateField = (
    fieldId: number,
    patch: Partial<Omit<MaterialTypeDraftField, 'id'>>
  ): void => {
    setFields((current) => current.map((field) => (
      field.id === fieldId ? { ...field, ...patch } : field
    )))
  }

  /**
   * 合并资源模板基本信息草稿，确保步骤切换不会丢失用户输入。
   * @param patch 需要更新的模板身份字段。
   * @returns 无返回值；仅更新本地 ResourceTemplate 草稿。
   */
  const updateBasicDraft = (patch: Partial<MaterialTypeBasicDraft>): void => {
    setBasicDraft((current) => ({ ...current, ...patch }))
  }

  /** 添加一个具备稳定配置键占位符的本地实例字段草稿。 */
  const addField = (): void => {
    const fieldId = nextFieldId.current
    nextFieldId.current += 1
    setFields((current) => [
      ...current,
      {
        id: fieldId,
        name: `自定义字段 ${fieldId}`,
        key: `customField${fieldId}`,
        type: 'text',
        required: false,
        defaultValue: '',
        description: ''
      }
    ])
  }

  /**
   * 删除一个本地实例字段草稿。
   *
   * @param fieldId 需要删除的草稿字段标识。
   * @returns 无返回值；不影响任何已存在的物料实例。
   */
  const removeField = (fieldId: number): void => {
    setFields((current) => current.filter((field) => field.id !== fieldId))
  }

  /** 仅切换 ResourceTemplate 草稿中允许承载的内容类型。 */
  const toggleCompatibleContent = (id: CompatibleContent): void => {
    setCompatibleContents((current) => ({ ...current, [id]: !current[id] }))
  }

  /** 切换允许放入的 Site 类型，不创建或变更 SiteOccupancy。 */
  const toggleCompatibleSite = (id: CompatibleSite): void => {
    setCompatibleSites((current) => ({ ...current, [id]: !current[id] }))
  }

  return (
    <section
      id="material-view-catalog"
      className={materialScopeClassName(
        'material-type-draft material-type-draft--embedded'
      )}
      role="tabpanel"
      aria-labelledby="material-tab-catalog"
      aria-label="物料管理"
    >
        <header>
          <div>
            <nav aria-label="物料类型创建路径">
              <button type="button" onClick={onClose}>物料管理</button>
              <span aria-hidden="true">›</span>
              <span>新建自定义类型</span>
            </nav>
            <h3 id="material-type-draft-title">新建物料类型</h3>
            <p>
              {seedName
                ? `以“${seedName}”为基础创建新的实验室私有资源模板。`
                : '依次定义类型身份、实例配置、内部结构和兼容边界。'}
            </p>
          </div>
          <div className="material-type-draft__page-status">
            <span>本地草稿</span>
            <strong>步骤 {activeStepIndex + 1} / {DRAFT_STEPS.length}</strong>
          </div>
        </header>

        <div className="material-type-draft__body">
          <nav aria-label="物料类型配置步骤">
            {DRAFT_STEPS.map((step, index) => (
              <button
                key={step.id}
                type="button"
                aria-current={activeStep === step.id ? 'step' : undefined}
                data-complete={visitedSteps.has(step.id) && activeStep !== step.id}
                onClick={() => goToStep(step.id)}
              >
                <span>{visitedSteps.has(step.id) && activeStep !== step.id ? '✓' : index + 1}</span>
                <strong>{step.label}</strong>
                <small>{step.id === 'fields' ? `${fields.length} 个字段` : step.hint}</small>
              </button>
            ))}
            <div className="material-type-draft__nav-note">
              <span aria-hidden="true">i</span>
              <p>当前内容保存在本地草稿中，尚未写入权威资源模板目录。</p>
            </div>
          </nav>

          <form onSubmit={(event) => event.preventDefault()}>
            {activeStep === 'basic' ? (
              <MaterialTypeBasicStep
                draft={basicDraft}
                titleRef={stepTitleRef}
                onChange={updateBasicDraft}
              />
            ) : null}
            {activeStep === 'fields' ? (
              <MaterialTypeFieldsStep
                fields={fields}
                titleRef={stepTitleRef}
                onAddField={addField}
                onUpdateField={updateField}
                onRemoveField={removeField}
              />
            ) : null}
            {activeStep === 'layout' ? (
              <MaterialTypeLayoutStep
                layout={layout}
                rows={rows}
                columns={columns}
                containerKind={containerKind}
                naming={naming}
                titleRef={stepTitleRef}
                onLayoutChange={setLayout}
                onRowsChange={setRows}
                onColumnsChange={setColumns}
                onContainerKindChange={setContainerKind}
                onNamingChange={setNaming}
              />
            ) : null}
            {activeStep === 'compatibility' ? (
              <MaterialTypeCompatibilityStep
                compatibleContents={compatibleContents}
                compatibleSites={compatibleSites}
                titleRef={stepTitleRef}
                onToggleContent={toggleCompatibleContent}
                onToggleSite={toggleCompatibleSite}
              />
            ) : null}
          </form>
        </div>

        <footer>
          <div role="note">
            <span aria-hidden="true">!</span>
            <span>当前服务只支持读取资源模板目录，尚未提供自定义模板写入接口。</span>
          </div>
          <button type="button" onClick={onClose}>取消</button>
          {activeStepIndex > 0 ? (
            <button type="button" onClick={() => goToStep(DRAFT_STEPS[activeStepIndex - 1].id)}>
              上一步
            </button>
          ) : null}
          {activeStepIndex < DRAFT_STEPS.length - 1 ? (
            <button
              type="button"
              className="is-primary"
              onClick={() => goToStep(DRAFT_STEPS[activeStepIndex + 1].id)}
            >
              下一步
            </button>
          ) : (
            <button
              type="button"
              className="is-primary"
              disabled
              title="资源模板写入接口尚未接入"
            >
              保存为私有类型
            </button>
          )}
        </footer>
    </section>
  )
}
