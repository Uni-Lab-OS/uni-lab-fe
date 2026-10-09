import { clsx } from 'clsx'
import workflowDebugPageStyles from './WorkflowDebugPage.module.scss'
import workflowSharedStyles from './WorkflowShared.module.scss'
import appShellStyles from '../../styles/app-shell.module.scss'
import sharedStyles from '../../styles/shared.module.scss'
import { Alert, Button, Form, Input, Select, Space, Steps, Tag, Tooltip } from 'antd'
import { RunPreparationSummary, RunSubmitConfirmation, WorkflowInputForm } from '@unilab/lab-ui'
import type { StudioRoute } from '../../components/AppShell'
import { AppIcon } from '../../components/ui/Icon'
import { AsyncState } from '../../components/ui/AsyncState'
import { PageHeader } from '../../components/ui/PageHeader'
import { useWorkflowDebugController } from './useWorkflowDebugController'
import { jsonText } from './workflowPresentation'
import { useBackend } from '../../app/BackendProvider'

export function WorkflowDebugPage({
  workflowUuid,
  onBack,
  onNavigate,
}: {
  workflowUuid: string
  onBack: () => void
  onNavigate: (route: StudioRoute) => void
}) {
  const {
    useRunPreparationStore,
    storeStatus,
    storeError,
    viewModel,
    revision,
    preflight,
    submitted,
    runMode,
    targetNodeUuid,
    priority,
    taskName,
    hasTaskConflict,
    step,
    setStep,
    workflowInput,
    setWorkflowInput,
    busy,
    formError,
    hasLocalWorkflowServiceError,
    inputParameters,
    targetNodeOptions,
    runPreflight,
    submit,
    messageContextHolder,
  } = useWorkflowDebugController(workflowUuid)
  return (
    <div
      className={clsx(
        appShellStyles['page-stack'],
        sharedStyles['page-stack'],
        workflowDebugPageStyles['workflow-debug-surface'],
        appShellStyles['workflow-debug-page'],
      )}
    >
      {messageContextHolder}
      <PageHeader
        title={revision?.name ?? '工作流调试'}
        leading={
          <Tooltip title="返回工作流">
            <Button
              type="text"
              className={clsx(sharedStyles['page-header-back'])}
              aria-label="返回工作流"
              onClick={onBack}
              icon={<AppIcon name="arrows/arrow-left" size={18} />}
            />
          </Tooltip>
        }
      />
      <AsyncState
        loading={storeStatus === 'loading' || storeStatus === 'idle'}
        // 提交/依赖检查失败时保留当前工作流页面，让步骤内的 formError 展示可操作提示；
        // 只有初次加载还没有 revision 时才显示整页数据加载错误。
        error={!revision ? (storeError ?? undefined) : undefined}
        onRetry={() => void useRunPreparationStore.getState().load(workflowUuid)}
        empty={storeStatus !== 'loading' && storeStatus !== 'idle' && !revision}
      >
        {revision && (
          <>
            <Steps
              className={clsx(workflowDebugPageStyles['workflow-debug-steps'])}
              current={step}
              items={[{ title: '填写入参' }, { title: '依赖检查' }, { title: '提交任务' }]}
            />
            {step === 0 && (
              <section
                className={clsx(
                  workflowSharedStyles['detail-card'],
                  appShellStyles['detail-card'],
                  workflowDebugPageStyles['debug-step-card'],
                )}
              >
                <div className={clsx(sharedStyles['section-title'])}>
                  <h2>填写运行参数</h2>
                  <Tag color="blue">v{revision.revision}</Tag>
                </div>
                <Form layout="vertical">
                  <div className={clsx(workflowDebugPageStyles['debug-run-options'])}>
                    <Form.Item label="运行模式">
                      <Select
                        showSearch
                        optionFilterProp="label"
                        value={runMode}
                        onChange={(value) =>
                          useRunPreparationStore.getState().updateConfiguration(
                            value === 'single_node'
                              ? { runMode: value as typeof runMode }
                              : {
                                  runMode: value as typeof runMode,
                                  targetNodeUuid: undefined,
                                },
                          )
                        }
                        options={[
                          { value: 'normal', label: '正常运行' },
                          { value: 'step', label: '单步运行' },
                          { value: 'single_node', label: '单节点运行' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label="优先级">
                      <Select
                        showSearch
                        optionFilterProp="label"
                        value={priority}
                        onChange={(value) =>
                          useRunPreparationStore.getState().updateConfiguration({
                            priority: value as 'normal' | 'high',
                          })
                        }
                        options={[
                          { value: 'normal', label: '普通' },
                          { value: 'high', label: '高' },
                        ]}
                      />
                    </Form.Item>
                    {runMode === 'single_node' && (
                      <Form.Item label="目标节点" required>
                        <Select
                          showSearch
                          optionFilterProp="label"
                          value={targetNodeUuid || undefined}
                          placeholder="请选择目标节点"
                          options={targetNodeOptions}
                          onChange={(value) =>
                            useRunPreparationStore.getState().updateConfiguration({
                              targetNodeUuid: value,
                            })
                          }
                        />
                      </Form.Item>
                    )}
                  </div>
                  <Form.Item label="任务名称" required>
                    <Input
                      value={taskName}
                      onChange={(event) =>
                        useRunPreparationStore.getState().updateConfiguration({
                          description: event.target.value,
                        })
                      }
                      placeholder="请输入任务名称"
                    />
                  </Form.Item>
                  <div
                    className={clsx(
                      workflowDebugPageStyles['workflow-input-section'],
                      inputParameters.length === 0
                        ? workflowDebugPageStyles['workflow-input-section--empty']
                        : '',
                    )}
                  >
                    <div
                      className={clsx(workflowDebugPageStyles['workflow-input-section__heading'])}
                    >
                      <strong>工作流参数</strong>
                    </div>
                    <WorkflowInputForm
                      parameters={inputParameters}
                      value={workflowInput}
                      onChange={setWorkflowInput}
                    />
                  </div>
                  {formError && (
                    <Alert
                      className={clsx('form-error')}
                      type="error"
                      showIcon
                      message={formError}
                    />
                  )}
                  <Button type="primary" loading={busy} onClick={runPreflight}>
                    {busy ? '正在检查运行条件…' : '下一步：依赖检查'}
                  </Button>
                  {busy && (
                    <Alert
                      type="info"
                      showIcon
                      message="正在等待 OS 校验结果"
                      description="大型工作流可能需要几分钟，请等待校验完成。"
                    />
                  )}
                </Form>
              </section>
            )}
            {step === 1 && (
              <section
                className={clsx(
                  workflowSharedStyles['detail-card'],
                  appShellStyles['detail-card'],
                  workflowDebugPageStyles['debug-step-card'],
                )}
              >
                {viewModel && <RunPreparationSummary viewModel={viewModel} preflight={preflight} />}
                {formError && (
                  <Alert
                    className={clsx('form-error')}
                    type="error"
                    showIcon
                    message={formError}
                    description={
                      hasLocalWorkflowServiceError
                        ? '后端可能已经创建任务，但本地调度尚未完成。请先到任务列表核对；若没有记录，确认本地工作流服务和设备动作定义后再重试。'
                        : undefined
                    }
                    action={
                      hasTaskConflict || hasLocalWorkflowServiceError ? (
                        <Button type="link" onClick={() => onNavigate('tasks')}>
                          查看任务列表
                        </Button>
                      ) : undefined
                    }
                  />
                )}
                <RunSubmitConfirmation
                  canSubmit={Boolean(preflight?.canRun)}
                  busy={busy}
                  onEdit={() => setStep(0)}
                  onSubmit={submit}
                  submitLabel="提交任务"
                />
              </section>
            )}
            {step === 2 && (
              <section
                className={clsx(
                  workflowSharedStyles['detail-card'],
                  appShellStyles['detail-card'],
                  workflowDebugPageStyles['debug-step-card'],
                  workflowDebugPageStyles['debug-step-card--submitted'],
                )}
              >
                <Alert
                  type="success"
                  showIcon
                  message="任务已提交"
                  description={
                    submitted ? (
                      <span className={clsx(workflowDebugPageStyles['debug-result-summary'])}>
                        <span>任务名称：{taskName}</span>
                        <span>任务编号：{submitted.taskUuid}</span>
                      </span>
                    ) : (
                      '后端已接受本次运行'
                    )
                  }
                />
                <Space className={clsx(workflowDebugPageStyles['debug-result-actions'])}>
                  <Button type="primary" onClick={() => onNavigate('tasks')}>
                    查看任务
                  </Button>
                  <Button onClick={onBack}>返回工作流</Button>
                </Space>
                <pre className={clsx(workflowDebugPageStyles['schema-block-pre'])}>
                  {jsonText(submitted?.raw)}
                </pre>
              </section>
            )}
          </>
        )}
      </AsyncState>
    </div>
  )
}
