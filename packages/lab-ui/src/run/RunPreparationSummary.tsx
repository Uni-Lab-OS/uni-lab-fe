import type { PreflightReport, RunPreparationViewModel } from '@unilab-fe/core'
import { InventoryRequirementList } from '../workflow/InventoryRequirementList'
import { PreflightReportView } from './PreflightReportView'

export interface RunPreparationSummaryProps {
  readonly viewModel: RunPreparationViewModel
  readonly preflight?: PreflightReport | null
}

/** 运行提交前的领域摘要；提交动作和 store 仍由场景拥有。 */
export function RunPreparationSummary({
  viewModel,
  preflight,
}: RunPreparationSummaryProps) {
  const { revision, configuration } = viewModel
  const inputCount = Object.keys(configuration.input).length

  return (
    <section
      className="lab-ui-run-preparation-summary"
      aria-label="运行准备摘要"
    >
      <header>
        <div>
          <span className="lab-ui-eyebrow">工作流</span>
          <h2>{revision.name}</h2>
        </div>
        <span>版本 {revision.revision}</span>
      </header>
      <div className="lab-ui-run-preparation-summary__columns">
        <section className="lab-ui-run-preparation-summary__basic">
          <h3>基础信息</h3>
          <dl className="lab-ui-definition-list">
            <div>
              <dt>运行模式</dt>
              <dd>{runModeLabel(configuration.runMode)}</dd>
            </div>
            <div>
              <dt>优先级</dt>
              <dd>{configuration.priority === 'high' ? '高' : '普通'}</dd>
            </div>
            <div>
              <dt>任务名称</dt>
              <dd>{configuration.description || '未填写'}</dd>
            </div>
            <div>
              <dt>输入参数</dt>
              <dd>{inputCount} 项</dd>
            </div>
          </dl>
        </section>
        <section className="lab-ui-run-preparation-summary__inventory">
          <h3>库存需求</h3>
          <InventoryRequirementList requirements={viewModel.requirements} />
        </section>
      </div>
      {preflight && <PreflightReportView report={preflight} />}
    </section>
  )
}

function runModeLabel(
  mode: RunPreparationViewModel['configuration']['runMode'],
): string {
  if (mode === 'step') return '单步运行'
  if (mode === 'single_node') return '单节点运行'
  return '正常运行'
}
