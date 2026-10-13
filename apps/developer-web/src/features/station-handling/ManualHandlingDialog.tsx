import { useState } from 'react'
import { clsx } from 'clsx'
import { Alert, Button, Form, Input, Modal, Tag } from 'antd'
import type { StationErrorFact, StationHandlingSession } from '@unilab-fe/core'
import stationStyles from './stationHandling.module.scss'
import { DeviceActionForm, MaterialPositionForm, OccupancyReleaseForm } from './ManualHandlingForms'
import { useManualHandling } from './useManualHandling'
import type { ManualOperationKind, ManualOperationView } from './manualHandlingModel'

const KIND_LABEL: Readonly<Record<ManualOperationKind, string>> = {
  device: '设备动作',
  material: '物料位置',
  occupancy: '释放占用',
}

const KIND_HINT: Readonly<Record<ManualOperationKind, string>> = {
  device: '让某台设备执行一个动作',
  material: '登记物料实际在哪 —— 搬过也好，本来就记错也好',
  occupancy: '释放逻辑占用，让后续调度不再认为它被占着',
}

const TONE_TAG: Readonly<Record<ManualOperationView['tone'], string>> = {
  ok: 'success',
  busy: 'processing',
  attention: 'warning',
}

/**
 * 人工处理弹窗。
 *
 * 三件事：添加处理操作、写处理说明、提交。
 *
 * 两个刻意的语义，写在这里免得后来的人改错：
 * 1. **操作即执行**：设备动作一旦执行就作用于真实设备，不能「先攒着再一起发」。
 *    底部「提交」是**结束这次会话**（OS 的 complete），不是提交一批操作。
 * 2. **提交被挡住时要说清原因**：动作未结束、结果待核对这两类由 OS 强制拒绝，
 *    界面做不了例外，只能如实说明卡在哪。
 *
 * 调用方必须按 `session.sessionId` 加 `key`（草稿与会话一一对应）。
 */
export function ManualHandlingDialog({
  error,
  session,
  onClose,
}: {
  error: StationErrorFact
  session: StationHandlingSession
  onClose: () => void
}) {
  const controller = useManualHandling(session)
  const [sheet, setSheet] = useState<ManualOperationKind | 'picker' | null>(null)
  const [noteForm] = Form.useForm<{ note: string }>()
  const { blockers, views } = controller

  const submit = async () => {
    try {
      await noteForm.validateFields()
    } catch {
      return
    }
    if (await controller.completeSession()) onClose()
  }

  return (
    <Modal
      open
      width={760}
      className={clsx(stationStyles['manual-modal'])}
      title="人工处理"
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      maskClosable={false}
    >
      <p className={clsx(stationStyles['manual-subtitle'])}>工站暂停中，提交后才能恢复调度</p>
      {/* 保留报错的红底与图标（它确实是错误），但压成一行：这条错误在抽屉的
          「异常处置」里已经完整显示过，弹窗里不需要再占一大块。 */}
      <Alert
        type="error"
        showIcon
        className={clsx(stationStyles['manual-error-strip'])}
        message={
          <span className={clsx(stationStyles['manual-error-text'])}>
            <strong className={clsx(stationStyles['manual-error-code'])}>
              {error.message?.split('：')[0] ?? '节点执行失败'}
            </strong>
            {error.message?.includes('：') && (
              <span className={clsx(stationStyles['manual-error-detail'])}>
                {error.message.split('：').slice(1).join('：')}
              </span>
            )}
          </span>
        }
      />

      <section className={clsx(stationStyles['manual-block'])}>
        <div className={clsx(stationStyles['manual-block-head'])}>
          <h3>处理操作</h3>
          <div className={clsx(stationStyles['manual-block-actions'])}>
            {views.length > 0 && <span>{views.length} 条</span>}
            <Button
              type="primary"
              size="small"
              disabled={controller.pending || sheet !== null}
              onClick={() => setSheet('picker')}
            >
              添加处理操作
            </Button>
          </div>
        </div>
        {views.length > 0 && (
          <ul className={clsx(stationStyles['manual-ops'])}>
            {views.map((view) => (
              <li key={view.id} className={clsx(stationStyles['manual-op'])}>
                <div className={clsx(stationStyles['manual-op-head'])}>
                  <span className={clsx(stationStyles['manual-op-kind'])}>
                    {KIND_LABEL[view.kind]}
                  </span>
                  <Tag color={TONE_TAG[view.tone]}>{view.status}</Tag>
                </div>
                <p className={clsx(stationStyles['manual-op-label'])}>{view.label}</p>
                {view.detail && (
                  <p className={clsx(stationStyles['manual-op-detail'])}>{view.detail}</p>
                )}
                {view.fromServer && (
                  <p className={clsx(stationStyles['manual-op-detail'])}>
                    这条来自工站状态，不是本次操作记录的。
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {sheet === 'picker' && (
          <div className={clsx(stationStyles['manual-sheet'])}>
            <div className={clsx(stationStyles['manual-sheet-head'])}>
              <strong>添加处理操作</strong>
              <Button type="text" onClick={() => setSheet(null)}>
                取消
              </Button>
            </div>
            {(['device', 'material', 'occupancy'] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                className={clsx(stationStyles['manual-kind-row'])}
                onClick={() => setSheet(kind)}
              >
                <strong>{KIND_LABEL[kind]}</strong>
                <small>{KIND_HINT[kind]}</small>
              </button>
            ))}
          </div>
        )}
        {sheet === 'device' && (
          <div className={clsx(stationStyles['manual-sheet'])}>
            <div className={clsx(stationStyles['manual-sheet-head'])}>
              <strong>设备动作</strong>
              <Button type="text" onClick={() => setSheet(null)}>
                取消
              </Button>
            </div>
            <DeviceActionForm
              session={session}
              sourceTaskUuid={error.sourceTaskUuid}
              draft={controller.draft}
              updateDraft={controller.updateDraft}
              pending={controller.pending}
              onSubmit={controller.submitOperation}
              onDone={() => setSheet(null)}
            />
          </div>
        )}
        {sheet === 'material' && (
          <div className={clsx(stationStyles['manual-sheet'])}>
            <div className={clsx(stationStyles['manual-sheet-head'])}>
              <strong>物料位置</strong>
              <Button type="text" onClick={() => setSheet(null)}>
                取消
              </Button>
            </div>
            <MaterialPositionForm
              session={session}
              sourceTaskUuid={error.sourceTaskUuid}
              draft={controller.draft}
              updateDraft={controller.updateDraft}
              pending={controller.pending}
              onSubmit={controller.submitOperation}
              onDone={() => setSheet(null)}
            />
          </div>
        )}
        {sheet === 'occupancy' && (
          <div className={clsx(stationStyles['manual-sheet'])}>
            <div className={clsx(stationStyles['manual-sheet-head'])}>
              <strong>释放占用</strong>
              <Button type="text" onClick={() => setSheet(null)}>
                取消
              </Button>
            </div>
            <OccupancyReleaseForm
              draft={controller.draft}
              updateDraft={controller.updateDraft}
              pending={controller.pending}
              onSubmit={controller.submitOperation}
              onDone={() => setSheet(null)}
            />
          </div>
        )}
      </section>

      <Form form={noteForm} layout="vertical" className={clsx(stationStyles['manual-note-form'])}>
        <Form.Item
          label="处理说明"
          name="note"
          required
          rules={[{ required: true, message: '请填写处理说明' }]}
        >
          <Input.TextArea
            rows={3}
            value={controller.note}
            onChange={(event) => controller.setNote(event.target.value)}
            placeholder="做了什么、现场现在什么状态"
          />
        </Form.Item>
      </Form>

      {controller.unconfirmed && (
        <Alert
          type="warning"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={`「${controller.unconfirmed.label}」的提交结果尚未确认`}
          description="将按原请求身份继续确认，不会创建第二条操作。"
          action={
            <Button
              size="small"
              disabled={controller.pending}
              onClick={() => void controller.retryUnconfirmed()}
            >
              按原请求重试
            </Button>
          }
        />
      )}
      {controller.submitError && (
        <Alert
          type="error"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={controller.submitError}
        />
      )}
      {controller.riskAckRequired && !blockers.blocked && (
        <Alert
          type="warning"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message="物料位置可能和现场不一致"
          description="你做了设备动作，但没有登记物料位置。系统不知道东西现在在哪。"
          action={
            <Button size="small" onClick={() => controller.setRiskAck(!controller.riskAck)}>
              {controller.riskAck ? '已确认承担' : '我确认承担'}
            </Button>
          }
        />
      )}

      {blockers.blocked && (
        <Alert
          type="error"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={
            blockers.unresolved.length > 0 && blockers.running.length === 0
              ? '有动作结果待核对，还不能提交'
              : '有动作还没结束，还不能提交'
          }
          description={
            <>
              {blockers.running.length > 0 && (
                <p>
                  还在执行：
                  {blockers.running
                    .map((job) => job.actionName ?? job.jobUuid.slice(0, 8))
                    .join('、')}
                  。等它结束，或到 Uni-Lab OS 控制台停止动作。
                </p>
              )}
              {blockers.unresolved.length > 0 && (
                <p>
                  结果不确定：
                  {blockers.unresolved
                    .map((job) => job.actionName ?? job.jobUuid.slice(0, 8))
                    .join('、')}
                  。OS 要求现场核对之后才允许提交；核对入口尚未接入本前端，请先在 Uni-Lab OS
                  控制台完成核对。
                </p>
              )}
            </>
          }
        />
      )}
      <div className={clsx(stationStyles['manual-footer'])}>
        <div className={clsx(stationStyles['manual-footer-info'])}>
          {blockers.blocked
            ? `${blockers.running.length + blockers.unresolved.length} 项未结束，不能提交`
            : controller.riskAckRequired && !controller.riskAck
              ? '需先确认承担物料位置不一致'
              : ''}
        </div>
        <div className={clsx(stationStyles['manual-form-actions'])}>
          <Button onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={controller.pending}
            disabled={!controller.canSubmit}
            onClick={() => void submit()}
          >
            提交
          </Button>
        </div>
      </div>
    </Modal>
  )
}
