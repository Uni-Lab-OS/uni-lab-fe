import { clsx } from 'clsx'
import reagentModalStyles from './ReagentModal.module.scss'
import { Alert, Button, Modal, Tag } from 'antd'
import { useEffect, useState } from 'react'
import type { ReagentInfo, ReagentStructure3d } from '@unilab-fe/core'
import { DefinitionList } from '@unilab/lab-ui'
import { useBackend } from '../../app/BackendProvider'

import { physicalStateLabel } from './reagentModalShared'

export function CatalogDetail({ info, onClose }: { info: ReagentInfo; onClose: () => void }) {
  const { backend } = useBackend()
  const canReadStructure = backend.getCapabilityStatus('reagentInfo.readStructure3d')
  const [structure, setStructure] = useState<ReagentStructure3d | null>(null)
  const [structureError, setStructureError] = useState<Error | null>(null)
  const [loading, setLoading] = useState(canReadStructure.available)

  useEffect(() => {
    if (!canReadStructure.available) return
    let active = true
    setLoading(true)
    void backend.core.reagentInventory
      .getReagentInfoStructure3d(info.reagentInfoUuid)
      .then((value) => {
        if (active) setStructure(value)
      })
      .catch((cause: unknown) => {
        if (active)
          setStructureError(cause instanceof Error ? cause : new Error('读取三维结构失败'))
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [backend, canReadStructure.available, info.reagentInfoUuid])

  return (
    <Modal
      open
      className={clsx(reagentModalStyles['reagent-detail-modal'])}
      width={640}
      title="试剂目录详情"
      footer={<Button onClick={onClose}>关闭</Button>}
      onCancel={onClose}
    >
      <div className={clsx(reagentModalStyles['reagent-detail-content'])}>
        <section
          className={clsx(reagentModalStyles['reagent-detail-section'])}
          aria-labelledby="reagent-detail-identity"
        >
          <h3 id="reagent-detail-identity">基础信息</h3>
          <DefinitionList
            variant="form"
            columns={2}
            className={clsx(reagentModalStyles['reagent-detail-grid'])}
            items={[
              { label: '名称', value: info.name },
              { label: '英文名', value: info.nameEn },
              {
                label: '别名',
                value: info.aliases.length ? info.aliases.join('、') : null,
                wide: true,
              },
            ]}
          />
        </section>

        <section
          className={clsx(reagentModalStyles['reagent-detail-section'])}
          aria-labelledby="reagent-detail-properties"
        >
          <h3 id="reagent-detail-properties">化学属性</h3>
          <DefinitionList
            variant="form"
            columns={2}
            className={clsx(reagentModalStyles['reagent-detail-grid'])}
            items={[
              { label: 'CAS 号', value: info.cas, mono: true },
              { label: '分子式', value: info.molecularFormula, mono: true },
              { label: '物态', value: physicalStateLabel(info.physicalState) },
              {
                label: '分子量',
                value: info.molecularWeight == null ? null : `${info.molecularWeight} g/mol`,
              },
              {
                label: '密度',
                value: info.densityGPerMl == null ? null : `${info.densityGPerMl} g/mL`,
              },
            ]}
          />
        </section>

        <section
          className={clsx(reagentModalStyles['reagent-detail-section'])}
          aria-labelledby="reagent-detail-identifiers"
        >
          <h3 id="reagent-detail-identifiers">结构标识</h3>
          <DefinitionList
            variant="form"
            columns={2}
            className={clsx(reagentModalStyles['reagent-detail-grid'])}
            items={[
              { label: 'SMILES', value: info.smiles, mono: true, wide: true },
              { label: 'InChIKey', value: info.inchiKey, mono: true, wide: true },
            ]}
          />
        </section>

        <section
          className={clsx(reagentModalStyles['reagent-detail-section'])}
          aria-labelledby="reagent-detail-notes"
        >
          <h3 id="reagent-detail-notes">备注</h3>
          <DefinitionList
            variant="form"
            columns={2}
            className={clsx(reagentModalStyles['reagent-detail-grid'])}
            items={[{ label: '描述', value: info.description, wide: true }]}
          />
        </section>

        <section
          className={clsx(reagentModalStyles['reagent-detail-section'])}
          aria-labelledby="reagent-detail-structure"
        >
          <h3 id="reagent-detail-structure">三维结构</h3>
          <div className={clsx(reagentModalStyles['reagent-detail-grid'])}>
            {!canReadStructure.available ? (
              <div
                className={clsx(
                  reagentModalStyles['reagent-detail-empty'],
                  reagentModalStyles['reagent-detail-field--wide'],
                )}
              >
                {canReadStructure.reason ?? '当前端点未开放三维结构读取能力'}
              </div>
            ) : loading ? (
              <div
                className={clsx(
                  reagentModalStyles['reagent-detail-empty'],
                  reagentModalStyles['reagent-detail-field--wide'],
                )}
              >
                正在读取结构缓存...
              </div>
            ) : structureError ? (
              <Alert
                className={clsx(reagentModalStyles['reagent-detail-field--wide'])}
                type="error"
                showIcon
                message="三维结构读取失败"
                description={structureError.message}
              />
            ) : structure?.content ? (
              <DefinitionList
                variant="form"
                columns={2}
                className={clsx(reagentModalStyles['reagent-detail-grid'])}
                items={[
                  { label: '状态', value: <Tag color="success">{structure.status}</Tag> },
                  { label: '格式', value: structure.format },
                  {
                    label: '来源',
                    value: `${structure.structureSource ?? ''}${structure.sourceId ? ` / ${structure.sourceId}` : ''}`,
                  },
                  { label: '生成时间', value: structure.generatedAt },
                  { label: '结构内容', value: `已缓存 ${structure.content.length} 字符` },
                ]}
              />
            ) : (
              <div
                className={clsx(
                  reagentModalStyles['reagent-detail-empty'],
                  reagentModalStyles['reagent-detail-field--wide'],
                )}
              >
                <Tag color="warning">待生成</Tag>
                <span>{structure?.errorMessage ?? '尚未生成'}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}
