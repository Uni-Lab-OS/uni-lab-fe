import { clsx } from 'clsx'
import runStyles from '../run.module.scss'
import sharedStyles from '../shared.module.scss'
import type { PreflightReport, RunPreparationViewModel } from '@unilab-fe/core'
import { InventoryRequirementList } from '../workflow/InventoryRequirementList'
import { PreflightReportView } from './PreflightReportView'
import { DefinitionList } from '../shared/DefinitionList'

export interface RunPreparationSummaryProps {
  readonly viewModel: RunPreparationViewModel
  readonly preflight?: PreflightReport | null
}

/** 运行提交前的领域摘要；提交动作和 store 仍由场景拥有。 */
export function RunPreparationSummary({ viewModel, preflight }: RunPreparationSummaryProps) {
  const { revision, configuration } = viewModel
  const inputCount = Object.keys(configuration.input).length

  return (
    <section
      className={clsx(runStyles['lab-ui-run-preparation-summary'])}
      aria-label="运行准备摘要"
    >
      <header>
        <div>
          <span className={clsx(sharedStyles['lab-ui-eyebrow'])}>工作流</span>
          <h2>{revision.name}</h2>
        </div>
        <span>版本 {revision.revision}</span>
      </header>
      <div className={clsx(runStyles['lab-ui-run-preparation-summary__columns'])}>
        <section className={clsx(runStyles['lab-ui-run-preparation-summary__basic'])}>
          <h3>基础信息</h3>
          <DefinitionList
            className={clsx(runStyles['lab-ui-definition'])}
            items={[
              { label: '运行模式', value: runModeLabel(configuration.runMode) },
              { label: '优先级', value: configuration.priority === 'high' ? '高' : '普通' },
              { label: '任务名称', value: configuration.description, missingText: '未填写' },
              { label: '输入参数', value: `${inputCount} 项` },
            ]}
          />
        </section>
        <section>
          <h3>库存需求</h3>
          <InventoryRequirementList
            requirements={viewModel.requirements}
            siteNames={requirementSiteNames(viewModel)}
          />
        </section>
      </div>
      {preflight && (
        <PreflightReportView
          report={preflight}
          candidates={viewModel.candidates}
          messageContext={{ workflowInput: configuration.input }}
        />
      )}
    </section>
  )
}

/** 库存需求键来自工作流图；库位名用来源节点上的库位 UUID 对物料图候选。 */
function requirementSiteNames(viewModel: RunPreparationViewModel): Record<string, string> {
  const siteLabels = new Map(
    (viewModel.candidates ?? [])
      .filter((candidate) => candidate.resourceKind === 'site' && candidate.label)
      .map((candidate) => [candidate.id, candidate.label]),
  )
  const sites: Record<string, string> = {}
  for (const requirement of viewModel.requirements) {
    const sourceNodeUuid = nestedString(requirement.metadata, ['unilab', 'material_source_node_uuid'])
    const node = viewModel.revision.graph.nodes.find((item) => item.uuid === sourceNodeUuid)
    const siteUuid = nestedString(node, ['param', 'site'])
    const siteName = siteUuid ? siteLabels.get(siteUuid) : undefined
    if (siteName) sites[requirement.requirementKey] = siteName
  }
  return sites
}

function nestedString(value: unknown, path: readonly string[]): string {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object') return ''
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' ? current.trim() : ''
}

function runModeLabel(mode: RunPreparationViewModel['configuration']['runMode']): string {
  if (mode === 'step') return '单步运行'
  if (mode === 'single_node') return '单节点运行'
  return '正常运行'
}
