import { useMemo, useState } from 'react'

import {
  formatReagentDate,
  formatReagentMeasurement,
  reagentHistoryForInfo,
  type CapabilityStatus,
  type ReagentHistoryEvent,
  type ReagentInfoProjection
} from './reagentWorkspace'

type ReagentHistoryEventFilter = 'all' | ReagentHistoryEvent['eventType']

/**
 * 在当前试剂详情中展示跨批次、跨容器的关联履历。
 * @param props 当前试剂信息、全部履历事件和履历读取能力。
 * @returns 只显示 `reagentInfoId` 匹配事件的紧凑时间线。
 */
export function ReagentHistoryPanel({
  reagentInfo,
  events,
  readStatus
}: {
  reagentInfo: ReagentInfoProjection
  events: readonly ReagentHistoryEvent[]
  readStatus: CapabilityStatus
}): React.JSX.Element {
  const [eventType, setEventType] = useState<ReagentHistoryEventFilter>('all')
  const associatedEvents = useMemo(
    () => readStatus.available
      ? reagentHistoryForInfo(events, reagentInfo.id)
      : [],
    [events, readStatus.available, reagentInfo.id]
  )
  const visibleEvents = eventType === 'all'
    ? associatedEvents
    : associatedEvents.filter((event) => event.eventType === eventType)

  return (
    <section className="reagent-history-panel" aria-label={`${reagentInfo.name}历史记录`}>
      <header>
        <div>
          <strong>历史记录</strong>
          <small>关联该试剂下的全部批次与容器</small>
        </div>
        <span>{visibleEvents.length} 条</span>
      </header>
      {!readStatus.available ? (
        <div className="reagent-capability-boundary" role="status">
          <span aria-hidden="true">!</span>
          <div>
            <strong>历史记录不可用</strong>
            <small>{readStatus.reason ?? '当前宿主未声明此能力'}</small>
          </div>
        </div>
      ) : (
        <label className="reagent-history-panel__filter">
          <span>事件类型</span>
          <select
            value={eventType}
            onChange={(event) => setEventType(
              event.target.value as ReagentHistoryEventFilter
            )}
          >
            <option value="all">全部事件</option>
            <option value="registered">登记试剂</option>
            <option value="received">接收入库</option>
            <option value="opened">首次开启</option>
            <option value="transferred">位置转移</option>
            <option value="consumed">实验消耗</option>
            <option value="adjusted">库存调整</option>
            <option value="disposed">报废处置</option>
          </select>
        </label>
      )}
      {visibleEvents.length ? (
        <ol className="reagent-history__timeline">
          {visibleEvents.map((event) => (
            <li key={event.id} data-event={event.eventType}>
              <span className="reagent-history__event-mark" aria-hidden="true" />
              <div>
                <header>
                  <strong>{historyEventLabel(event.eventType)}</strong>
                  {event.quantityDelta ? (
                    <span data-negative={event.quantityDelta.value < 0}>
                      {event.quantityDelta.value > 0 ? '+' : ''}
                      {formatReagentMeasurement(event.quantityDelta)}
                    </span>
                  ) : null}
                </header>
                <time dateTime={event.occurredAt}>
                  {formatReagentDate(event.occurredAt)} · {formatHistoryTime(
                    event.occurredAt
                  )}
                </time>
                <p>{event.detail}</p>
                <small>
                  {event.materialName} · {event.operator}
                  {event.workflowName ? ` · ${event.workflowName}` : ''}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <div className="reagent-history-panel__empty" role="status">
          <strong>暂无关联记录</strong>
          <small>{readStatus.available
            ? '该试剂尚无符合当前筛选条件的履历。'
            : '履历服务接入后才会显示真实记录。'}</small>
        </div>
      )}
    </section>
  )
}

/**
 * 将履历事件编码翻译为试剂详情使用的业务名称。
 * @param value 履历服务返回的闭集事件编码。
 * @returns 对应的中文事件名称。
 */
function historyEventLabel(value: ReagentHistoryEvent['eventType']): string {
  return ({
    registered: '登记试剂',
    received: '接收入库',
    opened: '首次开启',
    transferred: '位置转移',
    consumed: '实验消耗',
    adjusted: '库存调整',
    disposed: '报废处置'
  })[value]
}

/**
 * 将 ISO 时间格式化为详情履历使用的时分文本。
 * @param value 履历服务返回的 ISO 时间。
 * @returns 24 小时时分；非法时间返回破折号。
 */
function formatHistoryTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)
}
