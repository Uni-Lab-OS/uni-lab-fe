import { clsx } from 'clsx'
import reagentModalStyles from './ReagentModal.module.scss'
import { Alert, Button, List, Modal, Space, Switch, Typography, Upload } from 'antd'
import { useState } from 'react'
import { useBackend } from '../../app/BackendProvider'

import { ErrorAlert, useCapabilityGuard, type ImportOutcome } from './reagentModalShared'

export function ImportModal({
  target,
  onClose,
  onSaved,
}: {
  target: 'catalog' | 'inventory'
  onClose: () => void
  onSaved: () => void
}) {
  const { backend } = useBackend()
  const guard = useCapabilityGuard()
  const [file, setFile] = useState<File | null>(null)
  const [atomic, setAtomic] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [result, setResult] = useState<ImportOutcome | null>(null)

  const submit = async () => {
    if (!file) {
      setError(new Error('请先选择要导入的文件'))
      return
    }
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const input = { file, fileName: file.name, atomic }
      if (target === 'catalog') {
        guard('reagentInfo.batchImport')
        setResult(await backend.core.reagentInventory.importReagentInfos(input))
      } else {
        guard('inventory.batchImportReagents')
        setResult(await backend.core.reagentInventory.importReagents(input))
      }
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error('导入失败'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open
      className={clsx(reagentModalStyles['reagent-mutation-modal'])}
      width={640}
      title={target === 'catalog' ? '导入试剂目录' : '导入试剂库存'}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose}>关闭</Button>
          <Button type="primary" loading={loading} onClick={() => void submit()}>
            开始导入
          </Button>
        </Space>
      }
    >
      <div className={clsx(reagentModalStyles['reagent-import-body'])}>
        <Upload
          maxCount={1}
          accept=".json,.csv,.tsv,.xlsx"
          beforeUpload={(next) => {
            setFile(next as unknown as File)
            // 返回 false 阻止 antd 自行发起上传，文件交由 core 的端口提交。
            return false
          }}
          onRemove={() => setFile(null)}
        >
          <Button>选择 JSON / CSV / TSV / XLSX 文件</Button>
        </Upload>
        <Space align="center">
          <Switch checked={atomic} onChange={setAtomic} />
          <Typography.Text>原子导入</Typography.Text>
        </Space>
        {result && (
          <Alert
            type={result.failed > 0 ? 'warning' : 'success'}
            showIcon
            message={`共 ${result.total} 行，成功 ${result.created} 行，失败 ${result.failed} 行`}
            description={
              result.errors.length ? (
                <List
                  size="small"
                  dataSource={[...result.errors]}
                  renderItem={(row) => (
                    <List.Item>
                      第 {row.row ?? '?'} 行：
                      {row.errors.map((item) => `${item.field} ${item.message}`).join('；')}
                    </List.Item>
                  )}
                />
              ) : (
                '全部记录已写入'
              )
            }
          />
        )}
        <ErrorAlert error={error} />
      </div>
    </Modal>
  )
}
