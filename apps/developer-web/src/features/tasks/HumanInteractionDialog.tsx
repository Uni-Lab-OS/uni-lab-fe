import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Alert,
  Button,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Radio,
  Segmented,
  Space,
  Tag,
} from 'antd'
import {
  buildHumanInteractionReply,
  formForChoice,
  type HumanInteractionReplyBody,
  type HumanSketchInput,
  type WorkflowHumanInteraction,
} from '@unilab-fe/core'
import {
  CORNER_LABELS,
  EMPTY_SKETCH,
  SketchCanvas,
  type ImageState,
  type SketchMode,
} from './SketchCanvas'
import {
  formatDeadline,
  HUMAN_KIND_LABELS,
  HUMAN_STATUS_LABELS,
  isExpired,
  parseNumberInputs,
} from './humanInteractionModel'
import styles from './TaskHumanInteraction.module.scss'

/**
 * 处理一条 OS 人工交互。提交内容按 OS 校验规则由 core 构造；提交受理只表示 OS
 * 记录了回复，后续设备动作（如写路径、刮取）以任务与作业状态为准。
 */
export function HumanInteractionDialog({
  interaction,
  nodeLabel,
  imageUrl,
  onSubmit,
  onClose,
}: {
  interaction: WorkflowHumanInteraction
  nodeLabel: string | null
  imageUrl: string | null
  onSubmit: (body: HumanInteractionReplyBody) => Promise<void>
  onClose: () => void
}) {
  const kind = interaction.interactionKind
  const hasOptions = kind === 'choose' || kind === 'review'
  const [choice, setChoice] = useState<string | undefined>(undefined)
  const [text, setText] = useState(interaction.textDefault)
  const [values, setValues] = useState<string[]>(interaction.numberDefaults.map(String))
  const [sketch, setSketch] = useState<HumanSketchInput>(EMPTY_SKETCH)
  const [mode, setMode] = useState<SketchMode>('contour')
  const [image, setImage] = useState<ImageState>({ status: 'loading', width: 0, height: 0 })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const form =
    kind === 'review' && choice
      ? formForChoice(interaction, choice)
      : kind === 'review'
        ? 'none'
        : kind
  const needsText = form === 'text'
  const needsNumbers = form === 'numbers'
  const needsSketch = form === 'sketch'
  const expired = isExpired(interaction)
  const pending = interaction.status === 'pending' && !expired
  const choiceLabel = interaction.options.find((option) => option.value === choice)?.label

  const body = useMemo<{ value: HumanInteractionReplyBody | null; problem: string | null }>(() => {
    if (hasOptions && !choice) return { value: null, problem: '请选择处理方式' }
    if (needsSketch && image.status !== 'loaded') {
      return { value: null, problem: '图片未加载，无法在原始像素坐标上手绘' }
    }
    try {
      return {
        value: buildHumanInteractionReply(interaction, {
          choice,
          text,
          values: parseNumberInputs(values),
          sketch,
        }),
        problem: null,
      }
    } catch (cause) {
      return { value: null, problem: cause instanceof Error ? cause.message : '回复内容无效' }
    }
  }, [choice, hasOptions, image.status, interaction, needsSketch, sketch, text, values])

  const submit = async () => {
    if (!body.value) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit(body.value)
      setSubmitted(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败')
    } finally {
      setSubmitting(false)
    }
  }

  const undo = () =>
    setSketch((current) =>
      mode === 'contour'
        ? { ...current, x: current.x.slice(0, -1), y: current.y.slice(0, -1) }
        : {
            ...current,
            cornerX: current.cornerX.slice(0, -1),
            cornerY: current.cornerY.slice(0, -1),
          },
    )

  const confirmText = `确认按“${choiceLabel ?? HUMAN_KIND_LABELS[kind]}”提交？OS 收到后将继续执行后续步骤。`

  return (
    <Modal
      open
      width={1080}
      title={
        <Space wrap>
          <span>{HUMAN_KIND_LABELS[kind]}</span>
          {nodeLabel && <Tag>{nodeLabel}</Tag>}
          <Tag color={pending ? 'processing' : 'default'}>
            {expired && interaction.status === 'pending'
              ? '已超时'
              : HUMAN_STATUS_LABELS[interaction.status]}
          </Tag>
        </Space>
      }
      onCancel={onClose}
      footer={null}
    >
      <div className={clsx(styles['dialog-body'], !imageUrl && styles['dialog-body-single'])}>
        {imageUrl ? (
          <section className={clsx(styles['dialog-image'])} aria-label="复核图片">
            <SketchCanvas
              src={imageUrl}
              mode={mode}
              value={sketch}
              editable={pending && needsSketch && !submitted}
              onChange={setSketch}
              onImageState={setImage}
            />
            {image.status === 'error' && (
              <Alert
                type="error"
                showIcon
                message="图片无法加载"
                description={`地址：${imageUrl}。请确认 OS 控制台在线且图片仍存在；无图时不能手绘，其余选项仍可提交。`}
              />
            )}
            {image.status === 'loaded' && (
              <p className={clsx(styles['hint'])}>
                原图 {image.width} × {image.height} 像素；标点按原图像素记录，与缩放无关。
              </p>
            )}
          </section>
        ) : (
          interaction.image && (
            <Alert
              type="warning"
              showIcon
              message="OS 给出的图片不是浏览器可访问的地址"
              description={interaction.image}
            />
          )
        )}

        <section className={clsx(styles['dialog-form'])}>
          {interaction.prompt && <pre className={clsx(styles['prompt'])}>{interaction.prompt}</pre>}
          <p className={clsx(styles['hint'])}>{formatDeadline(interaction)}</p>

          {hasOptions && (
            <Radio.Group
              className={clsx(styles['options'])}
              value={choice}
              disabled={!pending || submitted}
              onChange={(event) => setChoice(event.target.value as string)}
            >
              {interaction.options.map((option) => (
                <Radio key={option.value} value={option.value}>
                  {option.label}
                  {option.form !== 'none' && (
                    <span className={clsx(styles['option-form'])}>
                      {option.form === 'text'
                        ? '需填写'
                        : option.form === 'numbers'
                          ? '需调整参数'
                          : '需手绘'}
                    </span>
                  )}
                </Radio>
              ))}
            </Radio.Group>
          )}

          {needsText && (
            <label className={clsx(styles['field'])}>
              <span>{kind === 'review' ? '条带编号' : '填写内容'}</span>
              <Input.TextArea
                autoSize={{ minRows: 1, maxRows: 6 }}
                value={text}
                maxLength={4096}
                disabled={!pending || submitted}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          )}

          {needsNumbers &&
            interaction.numberLabels.map((label, index) => (
              <label key={label} className={clsx(styles['field'])}>
                <span>{label}</span>
                <InputNumber
                  value={values[index] === '' ? null : Number(values[index])}
                  disabled={!pending || submitted}
                  onChange={(next) =>
                    setValues((current) =>
                      current.map((value, i) =>
                        i === index ? (next === null ? '' : String(next)) : value,
                      ),
                    )
                  }
                />
              </label>
            ))}

          {needsSketch && (
            <div className={clsx(styles['sketch-tools'])}>
              <Segmented
                value={mode}
                onChange={(next) => setMode(next as SketchMode)}
                options={[
                  { label: `轮廓点（${sketch.x.length}）`, value: 'contour' },
                  { label: `板角（${sketch.cornerX.length}/4）`, value: 'corners' },
                ]}
              />
              <Space>
                <Button size="small" onClick={undo} disabled={!pending || submitted}>
                  撤销
                </Button>
                <Button
                  size="small"
                  onClick={() => setSketch(EMPTY_SKETCH)}
                  disabled={!pending || submitted}
                >
                  清空
                </Button>
              </Space>
              <p className={clsx(styles['hint'])}>
                在图片上依次点击刮取区域轮廓（至少 3 点）。若 OS 未识别到板边界，需切到“板角”按
                {CORNER_LABELS.join('、')}点 4 个角；也可不标板角。
              </p>
            </div>
          )}

          {submitted ? (
            <Alert
              type="success"
              showIcon
              message="已提交，OS 已记录回复"
              description="后续步骤由 OS 继续调度；是否写入路径、执行刮取等以任务与节点状态为准。"
            />
          ) : (
            <>
              {!pending && (
                <Alert
                  type="warning"
                  showIcon
                  message={
                    expired
                      ? '已超过截止时间，OS 不再接受回复'
                      : `该请求${HUMAN_STATUS_LABELS[interaction.status]}，不能再回复`
                  }
                />
              )}
              {pending && body.problem && <p className={clsx(styles['problem'])}>{body.problem}</p>}
              {error && <Alert type="error" showIcon message="OS 未接受回复" description={error} />}
              <div className={clsx(styles['actions'])}>
                <Button onClick={onClose}>关闭</Button>
                <Popconfirm
                  title={confirmText}
                  okText="提交"
                  cancelText="再看看"
                  onConfirm={() => void submit()}
                  disabled={!body.value || !pending}
                >
                  <Button type="primary" loading={submitting} disabled={!body.value || !pending}>
                    {choiceLabel ? `提交：${choiceLabel}` : '提交'}
                  </Button>
                </Popconfirm>
              </div>
            </>
          )}
        </section>
      </div>
    </Modal>
  )
}
