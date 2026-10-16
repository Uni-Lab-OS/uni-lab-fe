import type { SchedulerTimeline, TimePlanSnapshot } from './model'

/**
 * OS-only 调度观测接口，只读。用于展示排程与实际执行，不提供任何执行授权；
 * 是否可用由 scheduler.timePlan 能力声明决定。
 */
export interface SchedulerTimePlanPort {
  getTimePlan(): Promise<TimePlanSnapshot>
  getTimeline(windowS?: number): Promise<SchedulerTimeline>
}
