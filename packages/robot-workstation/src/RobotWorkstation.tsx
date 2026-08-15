/*
 * THESIS: 四个工站能力由 Workbench 活动栏直接进入，业务内容不再拥有第二层导航。
 * OWN-WORLD: 冷灰工作区、白色仪器面板、真实数据空态与克制的状态层级。
 * STORY: 用户从浏览器侧边栏选择单一任务，并只读取后端能够证明的事实。
 */
import { ModuleHeader, WorkstationDataState } from './ModuleHeader'
import { BenchModule } from './modules/BenchModule'
import { PointManagementModule } from './modules/PointManagementModule'
import { ReagentModule } from './modules/ReagentModule'
import type { RobotWorkstationProps, WorkstationDataStatus } from './types'
import { uiClass } from './uiClasses'
import styles from './workstation.module.scss'

const ACTION_UNAVAILABLE: WorkstationDataStatus = {
  phase: 'unavailable',
  message: '当前 Workbench 没有提供设备动作服务，请先连接 Uni-Lab OS。'
}
const POINT_UNAVAILABLE: WorkstationDataStatus = {
  phase: 'unavailable',
  message: '当前后端尚未公开机械臂点位目录接口。前端夹具已隐藏，接口冻结前不会显示或保存伪点位。'
}

/**
 * 渲染由 Workbench 侧边栏选中的单一机械臂工站能力。
 * @param props 当前模块、真实数据快照、接口状态和可选动作调试内容。
 * @returns 不含内部模块导航的 Workbench 主区内容。
 */
export function RobotWorkstation({
  module,
  actionContent,
  pointSnapshot,
  pointStatus = POINT_UNAVAILABLE,
  benchSnapshot,
  benchStatus = { phase: 'loading', message: '正在读取公共物料图…' },
  reagentItems,
  reagentStatus = { phase: 'loading', message: '正在读取试剂库存…' },
  reagentInfos,
  reagentInfoStatus = { phase: 'loading', message: '正在读取试剂基础信息…' },
  reagentManagement,
  reagentInfoManagement
}: RobotWorkstationProps): React.JSX.Element {
  return (
    <section className={styles.workstation} aria-label={moduleLabel(module)}>
      <main className={styles.moduleContent}>
        {module === 'debug' ? (
          actionContent ?? (
            <div className={uiClass.modulePage} data-testid="workstation-debug">
              <ModuleHeader title="机械臂动作调试" description="读取 OS 上报的真实设备动作，并通过统一单动作任务接口调试。" />
              <WorkstationDataState status={ACTION_UNAVAILABLE} title="设备动作接口不可用" />
            </div>
          )
        ) : null}
        {module === 'points' ? (
          <PointManagementModule snapshot={pointSnapshot} status={pointStatus} />
        ) : null}
        {module === 'bench' ? (
          <BenchModule snapshot={benchSnapshot} status={benchStatus} />
        ) : null}
        {module === 'reagents' ? (
          <ReagentModule
            items={reagentItems}
            status={reagentStatus}
            infos={reagentInfos}
            infoStatus={reagentInfoStatus}
            management={reagentManagement}
            infoManagement={reagentInfoManagement}
          />
        ) : null}
      </main>
    </section>
  )
}

/**
 * 返回当前主区的中文可访问名称。
 * @param module Workbench 已选择的四个稳定模块标识之一。
 * @returns 对应模块的中文标题。
 */
function moduleLabel(module: RobotWorkstationProps['module']): string {
  if (module === 'debug') return '机械臂动作调试'
  if (module === 'points') return '机械臂点位管理'
  if (module === 'bench') return '实验台'
  return '试剂管理'
}
