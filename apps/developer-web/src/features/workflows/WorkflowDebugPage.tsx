import { cx } from "../../styles/styleMaps";
import {
  Alert,
  Button,
  Form,
  Input,
  Select,
  Space,
  Steps,
  Tag,
  Tooltip,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  RunPreparationSummary,
  RunSubmitConfirmation,
  WorkflowInputForm,
} from "@unilab/lab-ui";
import type { StudioRoute } from "../../components/AppShell";
import { AppIcon } from "../../components/ui/Icon";
import { AsyncState } from "../../components/ui/AsyncState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useBackend } from "../../app/BackendProvider";
import { createRunPreparationReactStore } from "@unilab-fe/core/react";
import { jsonText } from "./workflowPresentation";
import { normalizeWorkflowInput, workflowInputDefaults } from "./WorkflowInputFields";

export function WorkflowDebugPage({
  workflowUuid,
  onBack,
  onNavigate,
}: {
  workflowUuid: string;
  onBack: () => void;
  onNavigate: (route: StudioRoute) => void;
}) {
  const { backend } = useBackend();
  const useRunPreparationStore = useMemo(
    () => createRunPreparationReactStore(backend.core.runPreparation),
    [backend.core.runPreparation],
  );
  const storeStatus = useRunPreparationStore((state) => state.status);
  const storeError = useRunPreparationStore((state) => state.error);
  const viewModel = useRunPreparationStore((state) => state.viewModel);
  const revision = useRunPreparationStore((state) => state.viewModel?.revision);
  const preflight = useRunPreparationStore((state) => state.preflight);
  const submitted = useRunPreparationStore((state) => state.submittedRun);
  const configuration = useRunPreparationStore((state) => state.viewModel?.configuration);
  const runMode = configuration?.runMode ?? "normal";
  const priority = configuration?.priority ?? "normal";
  const taskName = configuration?.description ?? "";
  const [step, setStep] = useState(0);
  const [workflowInput, setWorkflowInput] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    void useRunPreparationStore.getState().load(workflowUuid);
  }, [useRunPreparationStore, workflowUuid]);

  const inputParameters = useMemo(
    () => revision?.graph.inputParameters ?? [],
    [revision],
  );
  useEffect(() => {
    if (!revision) return;
    const defaults = workflowInputDefaults(inputParameters);
    setWorkflowInput(configuration?.input ?? defaults);
    const current = useRunPreparationStore.getState().viewModel?.configuration;
    if (!current?.description) {
      useRunPreparationStore.getState().updateConfiguration({
        description: revision.name,
        input: configuration?.input ?? defaults,
      });
    }
  }, [configuration?.input, inputParameters, revision, useRunPreparationStore]);

  const runPreflight = async () => {
    if (!revision) return;
    setBusy(true);
    setFormError(null);
    try {
      if (!taskName.trim()) {
        setFormError("请填写任务名称");
        return;
      }
      const nextInput = normalizeWorkflowInput(workflowInput, inputParameters);
      const store = useRunPreparationStore.getState();
      store.updateConfiguration({
        runMode,
        priority,
        description: taskName.trim(),
        input: nextInput,
      });
      await store.requestPreflight();
      const nextState = useRunPreparationStore.getState();
      if (nextState.error) throw nextState.error;
      setStep(1);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "请完善必填运行参数",
      );
    } finally {
      setBusy(false);
    }
  };
  const submit = async () => {
    if (!revision || !preflight?.canRun) return;
    setBusy(true);
    setFormError(null);
    try {
      await useRunPreparationStore.getState().submitRun();
      const nextState = useRunPreparationStore.getState();
      if (nextState.error) throw nextState.error;
      if (!nextState.submittedRun) throw new Error("后端未返回已接受的任务");
      setStep(2);
      message.success("任务已提交");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className={cx("page-stack workflow-debug-page")}>
      <PageHeader
        title={revision?.name ?? "工作流调试"}
        leading={
          <Tooltip title="返回工作流">
            <Button
              type="text"
              className={cx("page-header-back")}
              aria-label="返回工作流"
              onClick={onBack}
              icon={<AppIcon name="arrows/arrow-left" size={18} />}
            />
          </Tooltip>
        }
      />
      <AsyncState
        loading={storeStatus === "loading" || storeStatus === "idle"}
        error={storeError ?? undefined}
        onRetry={() => void useRunPreparationStore.getState().load(workflowUuid)}
        empty={storeStatus !== "loading" && storeStatus !== "idle" && !revision}
      >
        {revision && (
          <>
            <Steps
              current={step}
              items={[
                { title: "填写入参" },
                { title: "依赖检查" },
                { title: "提交任务" },
              ]}
            />
            {step === 0 && (
              <section className={cx("detail-card debug-step-card")}>
                <div className={cx("section-title")}>
                  <h2>填写运行参数</h2>
                  <Tag color="blue">v{revision.revision}</Tag>
                </div>
                <Form layout="vertical">
                  <div className={cx("debug-run-options")}>
                    <Form.Item label="运行模式">
                      <Select
                        showSearch
                        optionFilterProp="label"
                        value={runMode}
                        onChange={(value) =>
                          useRunPreparationStore.getState().updateConfiguration({
                            runMode: value as typeof runMode,
                          })
                        }
                        options={[
                          { value: "normal", label: "正常运行" },
                          { value: "step", label: "单步运行" },
                          { value: "single_node", label: "单节点运行" },
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
                            priority: value as "normal" | "high",
                          })
                        }
                        options={[
                          { value: "normal", label: "普通" },
                          { value: "high", label: "高" },
                        ]}
                      />
                    </Form.Item>
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
                    className={cx(`workflow-input-section ${inputParameters.length === 0 ? "workflow-input-section--empty" : ""}`)}
                  >
                    <div className={cx("workflow-input-section__heading")}>
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
                      className={cx("form-error")}
                      type="error"
                      showIcon
                      message={formError}
                    />
                  )}
                  <Button type="primary" loading={busy} onClick={runPreflight}>
                    下一步：依赖检查
                  </Button>
                </Form>
              </section>
            )}
            {step === 1 && (
              <section className={cx("detail-card debug-step-card")}>
                {viewModel && (
                  <RunPreparationSummary
                    viewModel={viewModel}
                    preflight={preflight}
                  />
                )}
                {formError && (
                  <Alert
                    className={cx("form-error")}
                    type="error"
                    showIcon
                    message={formError}
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
              <section className={cx("detail-card debug-step-card debug-step-card--submitted")}>
                <Alert
                  type="success"
                  showIcon
                  message="任务已提交"
                  description={
                    submitted
                      ? (
                        <span className={cx("debug-result-summary")}>
                          <span>任务名称：{taskName}</span>
                          <span>任务编号：{submitted.taskUuid}</span>
                        </span>
                      )
                      : "后端已接受本次运行"
                  }
                />
                <Space className={cx("debug-result-actions")}>
                  <Button type="primary" onClick={() => onNavigate("tasks")}>
                    查看任务
                  </Button>
                  <Button onClick={onBack}>返回工作流</Button>
                </Space>
                <pre className={cx("schema-block-pre")}>
                  {jsonText(submitted?.raw)}
                </pre>
              </section>
            )}
          </>
        )}
      </AsyncState>
    </div>
  );
}
