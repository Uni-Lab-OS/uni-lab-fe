import { useState } from 'react'
import { clsx } from 'clsx'
import { Alert, Button, Checkbox, Form, Input } from 'antd'
import stationStyles from './stationHandling.module.scss'

/**
 * 手动动作的现场核对表单。
 *
 * 会话内核对与事后核对共用这一个表单 —— 两者要用户做的事完全一样，只是提交的端点不同。
 *
 * 文案上有一件必须说清的事：**核对只记录现场检查结论，不改变动作的实际执行结果**。
 * 把它说成「问题已解决」就是撒谎：不确定事实不会被清掉，资源占用也仍然要单独处理。
 */
export function ManualReviewForm({
  pending,
  submitError,
  onSubmit,
  onCancel,
}: {
  pending: boolean
  submitError?: string
  onSubmit: (reason: string) => Promise<boolean>
  onCancel?: () => void
}) {
  const [form] = Form.useForm<{ reason: string }>()
  const [confirmed, setConfirmed] = useState(false)

  const submit = async () => {
    try {
      await form.validateFields()
    } catch {
      return
    }
    const reason = (form.getFieldValue('reason') as string | undefined)?.trim() ?? ''
    if (!reason || !confirmed) return
    await onSubmit(reason)
  }

  return (
    <Form form={form} layout="vertical" className={clsx(stationStyles['manual-note-form'])}>
      <p className={clsx(stationStyles['manual-review-note'])}>
        核对只记录现场检查结论，不会改变动作的实际执行结果。
      </p>
      <Form.Item
        label="核对说明"
        name="reason"
        required
        rules={[{ required: true, message: '请填写核对说明' }]}
      >
        <Input.TextArea
          rows={2}
          placeholder="现场看到的是什么：动作是否已停止、执行结果、物料状态"
        />
      </Form.Item>
      <Checkbox
        className={clsx(stationStyles['manual-review-check'])}
        checked={confirmed}
        onChange={(event) => setConfirmed(event.target.checked)}
      >
        我已现场核对，确认动作已停止，并已检查执行结果及物料状态
      </Checkbox>
      {submitError && (
        <Alert
          type="error"
          showIcon
          className={clsx(stationStyles['manual-form-wide'])}
          message={submitError}
        />
      )}
      <div className={clsx(stationStyles['manual-form-actions'])}>
        {onCancel && (
          <Button type="text" onClick={onCancel} disabled={pending}>
            取消
          </Button>
        )}
        <Button
          type="primary"
          loading={pending}
          disabled={!confirmed}
          onClick={() => void submit()}
        >
          保存核对记录
        </Button>
      </div>
    </Form>
  )
}
