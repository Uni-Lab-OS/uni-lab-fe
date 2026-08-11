import { ReagentWorkbench } from '@unilab/reagent'
import { useServices } from '@unilab/services'
import { useStore } from 'zustand'

import { useLabInteractionStore } from '../../integrations/lab-workbench/LabInteractionProvider'
import { useMaterialRuntime } from '../../integrations/lab-workbench/MaterialRuntimeProvider'

/**
 * 将独立试剂模块接入当前实验室范围与共享物料选择状态。
 * @returns 应用一级导航下的试剂工作台；缺少实验室范围时失败关闭。
 */
export default function ReagentPanel(): React.JSX.Element {
  const services = useServices()
  const runtime = useMaterialRuntime()
  const interaction = useLabInteractionStore()
  const selectedMaterialIds = useStore(
    interaction,
    (state) => state.selectedMaterialIds
  )

  if (!runtime.store || !runtime.scope) {
    return (
      <ReagentUnavailable
        title="请选择实验室"
        reason="试剂模块需要实验室范围才能读取容器与库位信息。"
      />
    )
  }

  return (
    <ReagentWorkbench
      catalog={services.materials}
      profileId={`${services.backend.id}:${services.backend.apiUrl}`}
      scope={runtime.scope}
      capabilities={{
        readTemplates: runtime.getStatus('material.readTemplates'),
        readGraph: runtime.getStatus('material.readGraph')
      }}
      selectedMaterialIds={selectedMaterialIds}
      onSelectionChange={(materialIds) => {
        interaction.getState().selectMaterials(materialIds)
      }}
    />
  )
}

/**
 * 显示独立试剂模块无法建立实验室作用域时的恢复说明。
 * @param props 不可用标题与用户可执行的恢复原因。
 * @returns 可被辅助技术感知的失败关闭页面。
 */
function ReagentUnavailable({
  title,
  reason
}: {
  title: string
  reason: string
}): React.JSX.Element {
  return (
    <section className="app-loading" role="status" aria-live="polite">
      <strong>{title}</strong>
      <span>{reason}</span>
    </section>
  )
}
