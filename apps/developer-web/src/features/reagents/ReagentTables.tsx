import { clsx } from 'clsx'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Button, Space, Table, Tag, Tooltip } from 'antd'
import type { TableColumnsType } from 'antd'
import type { Reagent, ReagentInfo } from '@unilab-fe/core'
import { ReagentCatalogSummary, ReagentQuantitySummary } from '@unilab/lab-ui'
import { EmptyState } from '@unilab/design-v2'
import { AppIcon } from '../../components/ui/Icon'
import { TableText } from '../../components/ui/TableText'
import { formatCapacity } from './reagentCapacity'
import { physicalStateLabel } from './ReagentModal'
import styles from './ReagentPage.module.scss'

const PAGE_SIZE = 10

export function listPagination(page: number, total: number, onChange: (next: number) => void) {
  return {
    current: page,
    pageSize: PAGE_SIZE,
    total,
    hideOnSinglePage: false,
    showSizeChanger: false,
    showTotal: (count: number, range: [number, number]) =>
      count === 0 ? '共 0 条' : `${range[0]}-${range[1]} / 共 ${count} 条`,
    onChange,
  }
}

export function InventoryTable({
  data,
  page,
  total,
  onPageChange,
  canMutate,
  canDelete,
  canDispense,
  onHistory,
  canReadHistory,
  onEdit,
  onDispense,
  onDelete,
}: {
  data: readonly Reagent[]
  page: number
  total: number
  onPageChange: (next: number) => void
  canMutate: boolean
  canDelete: boolean
  canDispense: boolean
  onHistory: (item: Reagent) => void
  canReadHistory: boolean
  onEdit: (item: Reagent) => void
  onDispense: (item: Reagent) => void
  onDelete: (item: Reagent) => void
}) {
  const columns: TableColumnsType<Reagent> = [
    {
      title: '库存名称',
      key: 'name',
      width: 260,
      render: (_, item) => (
        <div className={clsx(appShellStyles['primary-cell'], sharedStyles['primary-cell'])}>
          <TableText text={item.name} />
          <span>
            {item.containerName ?? '容器未提供'}
            {item.containerBarcode ? ` / ${item.containerBarcode}` : ''}
          </span>
        </div>
      ),
    },
    {
      title: '化学身份',
      key: 'identity',
      width: 140,
      render: (_, item) => (
        <div
          className={clsx(
            appShellStyles['primary-cell'],
            sharedStyles['primary-cell'],
            'reagent-identifier-text',
          )}
        >
          <span>{item.cas ?? '无 CAS'}</span>
          <span>{item.molecularFormula ?? '分子式未提供'}</span>
        </div>
      ),
    },
    {
      title: '余量',
      key: 'quantity',
      width: 155,
      render: (_, item) => <ReagentQuantitySummary reagent={item} />,
    },
    {
      title: '物性',
      key: 'property',
      width: 185,
      render: (_, item) => (
        <div className={clsx(appShellStyles['primary-cell'], sharedStyles['primary-cell'])}>
          <span>
            {physicalStateLabel(item.physicalState)}
            {item.concentrationValue != null
              ? ` / ${item.concentrationValue}${item.concentrationUnit ?? ''}`
              : ''}
          </span>
          <span>
            {item.densityGPerMl == null
              ? '密度未提供'
              : `${item.densityGPerMl} g/mL${item.densitySource ? ` · ${item.densitySource}` : ''}`}
          </span>
        </div>
      ),
    },
    {
      title: '装料上限',
      key: 'capacity',
      width: 120,
      render: (_, item) => (
        <Tooltip
          title={
            <>
              <div>额定规格 {formatCapacity(item.ratedCapacity)}</div>
              <div>手工配置 {formatCapacity(item.configuredCapacity)}</div>
              <div>容器物料 {item.materialUuid}</div>
            </>
          }
        >
          <span className={clsx(sharedStyles['muted-cell'])}>
            {formatCapacity(item.maximumCapacity)}
          </span>
        </Tooltip>
      ),
    },
    {
      title: '更新时间',
      key: 'updatedAt',
      width: 165,
      render: (_, item) => (
        <div className={clsx(appShellStyles['primary-cell'], sharedStyles['primary-cell'])}>
          <span>{item.updatedAt ?? '未提供'}</span>
          <span>
            版本 {item.revision ?? '未提供'} · 物料 {item.materialRevision ?? '未提供'}
          </span>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'operation',
      align: 'right',
      width: 180,
      render: (_, item) => (
        <Space size={2}>
          <Tooltip title={canReadHistory ? '查看历史' : '当前端点不支持库存历史'}>
            <Button
              className={clsx(sharedStyles['icon-button'])}
              type="text"
              icon={<AppIcon name="time/clock-refresh" size={18} />}
              onClick={() => onHistory(item)}
              disabled={!canReadHistory}
            />
          </Tooltip>
          <Tooltip title={canDispense ? '分装到其他容器' : '当前端点不支持分装'}>
            <Button
              className={clsx(sharedStyles['icon-button'])}
              type="text"
              disabled={!canDispense}
              icon={
                <AppIcon
                  name="weather/droplets-01"
                  color={canDispense ? 'primary' : 'context'}
                  size={18}
                />
              }
              onClick={() => onDispense(item)}
            />
          </Tooltip>
          <Tooltip title={canMutate ? '编辑库存' : '当前端点不支持此项写入'}>
            <Button
              className={clsx(sharedStyles['icon-button'])}
              type="text"
              disabled={!canMutate}
              icon={
                <AppIcon
                  name="general/edit-05"
                  color={canMutate ? 'primary' : 'context'}
                  size={18}
                />
              }
              onClick={() => onEdit(item)}
            />
          </Tooltip>
          <Tooltip title={canDelete ? '删除库存' : '当前端点不支持删除'}>
            <Button
              className={clsx(sharedStyles['icon-button'])}
              type="text"
              danger
              disabled={!canDelete}
              icon={<AppIcon name="general/trash-01" size={18} />}
              onClick={() => onDelete(item)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]
  return (
    <Table<Reagent>
      className={styles.reagentTable}
      rowKey="reagentUuid"
      columns={columns}
      dataSource={[...data]}
      locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无库存" /> }}
      pagination={listPagination(page, total, onPageChange)}
    />
  )
}

export function CatalogTable({
  data,
  page,
  total,
  onPageChange,
  canMutate,
  canEdit,
  canDelete,
  onDetail,
  onEdit,
  onCreateInventory,
  onDelete,
}: {
  data: readonly ReagentInfo[]
  page: number
  total: number
  onPageChange: (next: number) => void
  canMutate: boolean
  canEdit: boolean
  canDelete: boolean
  onDetail: (item: ReagentInfo) => void
  onEdit: (item: ReagentInfo) => void
  onCreateInventory: (item: ReagentInfo) => void
  onDelete: (item: ReagentInfo) => void
}) {
  const columns: TableColumnsType<ReagentInfo> = [
    {
      title: '试剂名称',
      key: 'name',
      width: 330,
      render: (_, item) => <ReagentCatalogSummary info={item} />,
    },
    {
      title: 'CAS 号',
      dataIndex: 'cas',
      width: 175,
      render: (value: string | null) => (
        <span className={clsx('reagent-identifier-text')}>{value ?? '未提供'}</span>
      ),
    },
    {
      title: '物态',
      dataIndex: 'physicalState',
      width: 120,
      render: (value: string) => <Tag color="blue">{physicalStateLabel(value)}</Tag>,
    },
    {
      title: '分子式',
      dataIndex: 'molecularFormula',
      width: 120,
      render: (value: string | null) => (
        <span className={clsx('reagent-identifier-text')}>{value ?? '未提供'}</span>
      ),
    },
    {
      title: 'SMILES',
      dataIndex: 'smiles',
      width: 180,
      render: (value: string | null) =>
        value ? <TableText className={clsx('reagent-identifier-text')} text={value} /> : '未提供',
    },
    {
      title: '分子量',
      dataIndex: 'molecularWeight',
      width: 130,
      render: (value: number | null) => (value == null ? '未提供' : `${value} g/mol`),
    },
    {
      title: '操作',
      key: 'operation',
      align: 'right',
      width: 180,
      render: (_, item) => (
        <Space size={2}>
          <Tooltip title="查看详情">
            <Button
              className={clsx(sharedStyles['icon-button'])}
              type="text"
              icon={<AppIcon name="general/eye" size={18} />}
              onClick={() => onDetail(item)}
            />
          </Tooltip>
          <Tooltip title={canMutate ? '录入库存' : '当前端点不支持此项写入'}>
            <Button
              className={clsx(sharedStyles['icon-button'])}
              type="text"
              disabled={!canMutate}
              icon={
                <AppIcon name="general/plus" color={canMutate ? 'primary' : 'context'} size={18} />
              }
              onClick={() => onCreateInventory(item)}
            />
          </Tooltip>
          <Tooltip title={canEdit ? '编辑目录' : '当前端点不支持目录修改'}>
            <Button
              className={clsx(sharedStyles['icon-button'])}
              type="text"
              disabled={!canEdit}
              icon={
                <AppIcon name="general/edit-05" color={canEdit ? 'primary' : 'context'} size={18} />
              }
              onClick={() => onEdit(item)}
            />
          </Tooltip>
          <Tooltip title={canDelete ? '删除目录' : '当前端点不支持目录删除'}>
            <Button
              className={clsx(sharedStyles['icon-button'])}
              type="text"
              danger
              disabled={!canDelete}
              icon={<AppIcon name="general/trash-01" size={18} />}
              onClick={() => onDelete(item)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ]
  return (
    <Table<ReagentInfo>
      className={styles.reagentTable}
      rowKey="reagentInfoUuid"
      columns={columns}
      dataSource={[...data]}
      locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无试剂目录" /> }}
      pagination={listPagination(page, total, onPageChange)}
    />
  )
}
