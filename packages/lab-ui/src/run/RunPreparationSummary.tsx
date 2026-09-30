import type { PreflightReport, RunPreparationViewModel } from '@unilab-fe/core'
import { InventoryRequirementList } from '../workflow/InventoryRequirementList'
import { PreflightReportView } from './PreflightReportView'
import { DefinitionList } from '../shared/DefinitionList'

import { cx } from '../classNames'
export interface RunPreparationSummaryProps {
  readonly viewModel: RunPreparationViewModel
  readonly preflight?: PreflightReport | null
}

/** 运行提交前的领域摘要；提交动作和 store 仍由场景拥有。 */
export function RunPreparationSummary({ viewModel, preflight }: RunPreparationSummaryProps) {
  const { revision, configuration } = viewModel
  const inputCount = Object.keys(configuration.input).length

  return (
    <section className={cx('lab-ui-run-preparation-summary')} aria-label="运行准备摘要">
      <header>
        <div>
          <span className={cx('lab-ui-eyebrow')}>工作流</span>
          <h2>{revision.name}</h2>
        </div>
        <span>版本 {revision.revision}</span>
      </header>
      <div className={cx('lab-ui-run-preparation-summary__columns')}>
        <section className={cx('lab-ui-run-preparation-summary__basic')}>
          <h3>基础信息</h3>
          <DefinitionList
            className={cx('lab-ui-definition-list')}
            items={[
              { label: '运行模式', value: runModeLabel(configuration.runMode) },
              { label: '优先级', value: configuration.priority === 'high' ? '高' : '普通' },
              { label: '任务名称', value: configuration.description, missingText: '未填写' },
              { label: '输入参数', value: `${inputCount} 项` },
            ]}
          />
        </section>
        <section className={cx('lab-ui-run-preparation-summary__inventory')}>
          <h3>库存需求</h3>
          <InventoryRequirementList requirements={viewModel.requirements} />
        </section>
      </div>
      {preflight && <PreflightReportView report={preflight} />}
    </section>
  )
}

function runModeLabel(mode: RunPreparationViewModel['configuration']['runMode']): string {
  if (mode === 'step') return '单步运行'
  if (mode === 'single_node') return '单节点运行'
  return '正常运行'
}
