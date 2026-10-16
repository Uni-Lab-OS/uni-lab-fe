import type { RequestTransport } from '../../transport/request'
import { decodeSchedulerTimeline, decodeTimePlan } from './codec'
import type { SchedulerTimeline, TimePlanSnapshot } from './model'
import type { SchedulerTimePlanPort } from './port'

/** 两个接口直接返回只读对象，不使用任务接口的 envelope。 */
export class SchedulerTimePlanClient implements SchedulerTimePlanPort {
  constructor(
    private readonly transport: RequestTransport,
    private readonly apiPrefix = '/api/v1',
  ) {}

  async getTimePlan(): Promise<TimePlanSnapshot> {
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.apiPrefix}/scheduler/time-plan`,
    })
    return decodeTimePlan(response.data)
  }

  async getTimeline(windowS = 6 * 3600): Promise<SchedulerTimeline> {
    const response = await this.transport.request<unknown>({
      method: 'GET',
      url: `${this.apiPrefix}/timeline?window_s=${encodeURIComponent(String(windowS))}`,
    })
    return decodeSchedulerTimeline(response.data)
  }
}
