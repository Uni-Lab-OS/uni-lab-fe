import { cx } from './reagentModalClassNames'
import { Alert, Button, List, Modal, Pagination, Typography } from 'antd'
import { useEffect, useState } from 'react'
import type { Reagent, ReagentHistoryPage } from '@unilab-fe/core'
import { useBackend } from '../../app/BackendProvider'

import { historyEventLabel } from './reagentModalShared'

export function HistoryModal({ reagent, onClose }: { reagent: Reagent; onClose: () => void }) {
  const { backend } = useBackend()
  const status = backend.getCapabilityStatus('inventory.readReagentHistory')
  const [page, setPage] = useState(1)
  const [history, setHistory] = useState<ReagentHistoryPage | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(status.available)
  const pageSize = 10

  useEffect(() => {
    if (!status.available) {
      setError(new Error(status.reason ?? '当前端点未开放库存历史读取能力'))
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void backend.core.reagentInventory
      .listReagentHistory(reagent.materialUuid, { page, pageSize })
      .then((value) => {
        if (active) setHistory(value)
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause : new Error('读取历史失败'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [backend, page, reagent.materialUuid, status.available, status.reason])

  return (
    <Modal
      open
      width={680}
      title={`库存历史 · ${reagent.name}`}
      footer={<Button onClick={onClose}>关闭</Button>}
      onCancel={onClose}
    >
      {loading ? (
        <Typography.Text type="secondary">正在读取不可变库存台账...</Typography.Text>
      ) : error ? (
        <Alert type="error" showIcon message="历史读取失败" description={error.message} />
      ) : history?.items.length ? (
        <>
          <List
            className={cx('history-list')}
            dataSource={[...history.items]}
            renderItem={(item) => (
              <List.Item>
                <div>
                  <strong>{historyEventLabel(item.eventType)}</strong>
                  <span>
                    {item.quantityDelta == null
                      ? '数量未提供'
                      : `${item.quantityDelta > 0 ? '+' : ''}${item.quantityDelta} ${item.quantityUnit ?? ''}`}
                  </span>
                </div>
                <small>
                  {item.recordedAt} / {item.operatorType}
                  {/* 录入时填的来源存在台账扩展里，是追溯这条变更的关键线索。 */}
                  {typeof item.extension.source === 'string' && item.extension.source !== ''
                    ? ` / ${item.extension.source}`
                    : ''}
                  {item.causationId ? ` / 关联 ${item.causationId}` : ''}
                </small>
              </List.Item>
            )}
          />
          <Pagination
            className={cx('reagent-history-pagination')}
            simple
            current={page}
            pageSize={pageSize}
            // OS 只返回 has_more，不返回总数；这里按"当前页+是否还有下一页"推算。
            total={page * pageSize + (history.hasMore ? 1 : 0)}
            onChange={setPage}
          />
        </>
      ) : (
        <Typography.Text type="secondary">暂无库存变更记录</Typography.Text>
      )}
    </Modal>
  )
}
