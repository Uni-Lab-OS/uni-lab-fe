import {
  Alert,
  Button,
  Collapse,
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
import type {
  PublishedWorkflowRevision,
  PreflightReport,
  RunPreparationState,
  SubmittedRun,
} from "@unilab-fe/core";
import type { StudioRoute } from "../../components/AppShell";
import { AppIcon } from "../../components/ui/Icon";
import { AsyncState } from "../../components/ui/AsyncState";
import { PageHeader } from "../../components/ui/PageHeader";
import { useBackend } from "../../app/BackendProvider";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import { jsonText, nodeLabel } from "./workflowPresentation";
import {
  normalizeWorkflowInput,
  workflowInputDefaults,
  WorkflowInputFields,
} from "./WorkflowInputFields";

function preflightStatusLabel(status?: PreflightReport["status"]) {
  switch (status) {
    case "runnable_now":
      return "可提交";
    case "temporarily_unavailable":
      return "暂不可提交";
    case "invalid":
      return "参数无效";
    default:
      return "未执行";
  }
}

function preflightStatusColor(
  status?: PreflightReport["status"],
): "default" | "green" | "orange" | "red" {
  switch (status) {
    case "runnable_now":
      return "green";
    case "temporarily_unavailable":
      return "orange";
    case "invalid":
      return "red";
    default:
      return "default";
  }
}

function preflightCheckLabel(status: PreflightReport["checks"][number]["status"]) {
  switch (status) {
    case "passed":
      return "已通过";
    case "blocked":
      return "已阻塞";
    case "deferred":
      return "待复核";
    case "confirmation_required":
      return "待确认";
  }
}

function preflightCheckColor(
  status: PreflightReport["checks"][number]["status"],
): "blue" | "green" | "orange" | "red" {
  switch (status) {
    case "passed":
      return "green";
    case "blocked":
      return "red";
    case "deferred":
      return "orange";
    case "confirmation_required":
      return "blue";
  }
}

type PreflightCheck = PreflightReport["checks"][number];
type PreflightCheckStatus = PreflightCheck["status"];

const preflightCheckGroups: ReadonlyArray<{
  key: PreflightCheckStatus;
  title: string;
  color: "blue" | "green" | "orange" | "red";
}> = [
  { key: "blocked", title: "阻塞项", color: "red" },
  { key: "confirmation_required", title: "待确认", color: "blue" },
  { key: "deferred", title: "待复核", color: "orange" },
  { key: "passed", title: "已通过", color: "green" },
];

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
  const query = useBackendQuery(`workflow-debug:${workflowUuid}`, (backend) =>
    backend.core.workflowDefinitions.getPublishedRevision(workflowUuid),
  );
  const [step, setStep] = useState(0);
  const [runMode, setRunMode] =
    useState<RunPreparationState["configuration"]["runMode"]>("normal");
  const [priority, setPriority] = useState<"normal" | "high">("normal");
  const [taskName, setTaskName] = useState("");
  const [inputValues, setInputValues] = useState<Record<string, unknown>>({});
  const [inputForm] = Form.useForm<Record<string, unknown>>();
  const [preflight, setPreflight] = useState<PreflightReport | null>(null);
  const [submitted, setSubmitted] = useState<SubmittedRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const revision = query.data;
  const inputParameters = useMemo(
    () => revision?.graph.inputParameters ?? [],
    [revision],
  );
  const groupedPreflightChecks = useMemo(
    () =>
      preflight
        ? preflightCheckGroups
            .map((group) => ({
              ...group,
              checks: preflight.checks.filter(
                (check) => check.status === group.key,
              ),
            }))
            .filter((group) => group.checks.length > 0)
        : [],
    [preflight],
  );
  const defaultPreflightActiveKeys = useMemo(() => {
    const priorityGroups = groupedPreflightChecks.filter(
      (group) =>
        group.key === "blocked" || group.key === "confirmation_required",
    );
    return (priorityGroups.length > 0
      ? priorityGroups
      : groupedPreflightChecks.slice(0, 1)
    ).map((group) => group.key);
  }, [groupedPreflightChecks]);

  useEffect(() => {
    if (!revision) return;
    const defaults = workflowInputDefaults(inputParameters);
    inputForm.setFieldsValue({ workflowInput: defaults });
    setInputValues(defaults);
    setTaskName((current) => current || revision.name);
  }, [inputForm, inputParameters, revision]);

  const state = useMemo(() => {
    if (!revision) return null;
    return {
      revision,
      configuration: {
        runMode,
        priority,
        description: taskName.trim() || undefined,
        input: inputValues,
      },
      binding: {
        source: "user" as const,
        inventoryBindings: [],
        selectedResources: {},
      },
    } satisfies RunPreparationState;
  }, [inputValues, priority, revision, runMode, taskName]);
  const runPreflight = async () => {
    if (!revision) return;
    setBusy(true);
    setFormError(null);
    try {
      if (!taskName.trim()) {
        setFormError("请填写任务名称");
        return;
      }
      const values = await inputForm.validateFields();
      const nextInput = normalizeWorkflowInput(values, inputParameters);
      setInputValues(nextInput);
      const nextState: RunPreparationState = {
        revision,
        configuration: {
          runMode,
          priority,
          description: taskName.trim(),
          input: nextInput,
        },
        binding: {
          source: "user",
          inventoryBindings: [],
          selectedResources: {},
        },
      };
      const report = await backend.core.runPreparation.requestPreflight(
        nextState,
      );
      setPreflight(report);
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
    if (!state || !preflight?.canRun) return;
    setBusy(true);
    setFormError(null);
    try {
      const result = await backend.core.runPreparation.submitRun(state);
      setSubmitted(result);
      setStep(2);
      message.success("任务已提交");
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-stack workflow-debug-page">
      <PageHeader
        title={revision?.name ?? "工作流调试"}
        leading={
          <Tooltip title="返回工作流">
            <Button
              type="text"
              className="page-header-back"
              aria-label="返回工作流"
              onClick={onBack}
              icon={<AppIcon name="arrows/arrow-left" size={18} />}
            />
          </Tooltip>
        }
      />
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        empty={!query.loading && !revision}
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
              <section className="detail-card debug-step-card">
                <div className="section-title">
                  <h2>填写运行参数</h2>
                  <Tag color="blue">v{revision.revision}</Tag>
                </div>
                <Form form={inputForm} layout="vertical">
                  <div className="debug-run-options">
                    <Form.Item label="运行模式">
                      <Select
                        showSearch
                        optionFilterProp="label"
                        value={runMode}
                        onChange={setRunMode}
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
                        onChange={setPriority}
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
                      onChange={(event) => setTaskName(event.target.value)}
                      placeholder="请输入任务名称"
                    />
                  </Form.Item>
                  <div
                    className={`workflow-input-section ${inputParameters.length === 0 ? "workflow-input-section--empty" : ""}`}
                  >
                    <div className="workflow-input-section__heading">
                      <strong>工作流参数</strong>
                    </div>
                    <WorkflowInputFields parameters={inputParameters} />
                  </div>
                  {formError && (
                    <Alert
                      className="form-error"
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
              <section className="detail-card debug-step-card">
                <div className="section-title">
                  <h2>依赖检查</h2>
                  <Tag color={preflightStatusColor(preflight?.status)}>
                    {preflightStatusLabel(preflight?.status)}
                  </Tag>
                </div>
                {preflight && (
                  <Collapse
                    className="preflight-accordion"
                    bordered={false}
                    defaultActiveKey={defaultPreflightActiveKeys}
                    items={groupedPreflightChecks.map((group) => ({
                      key: group.key,
                      label: (
                        <span className="preflight-group-label">
                          <strong>{group.title}</strong>
                          <span>{group.checks.length} 项</span>
                        </span>
                      ),
                      extra: <Tag color={group.color}>{group.title}</Tag>,
                      children: (
                        <div className="preflight-list">
                          {group.checks.map((check, index) => (
                            <div
                              className={`preflight-item preflight-item--${check.status}`}
                              key={`${check.code}-${check.nodeUuid ?? "global"}-${index}`}
                            >
                              <span className="preflight-dot" />
                              <div>
                                <strong>{check.message}</strong>
                                <small>
                                  {check.code}
                                  {check.nodeName ? ` · ${check.nodeName}` : ""}
                                </small>
                              </div>
                              <Tag color={preflightCheckColor(check.status)}>
                                {preflightCheckLabel(check.status)}
                              </Tag>
                            </div>
                          ))}
                        </div>
                      ),
                    }))}
                  />
                )}
                {formError && (
                  <Alert
                    className="form-error"
                    type="error"
                    showIcon
                    message={formError}
                  />
                )}
                <Space>
                  <Button onClick={() => setStep(0)}>返回修改</Button>
                  <Button
                    type="primary"
                    loading={busy}
                    disabled={!preflight?.canRun}
                    onClick={submit}
                  >
                    提交任务
                  </Button>
                </Space>
              </section>
            )}
            {step === 2 && (
              <section className="detail-card debug-step-card debug-step-card--submitted">
                <Alert
                  type="success"
                  showIcon
                  message="任务已提交"
                  description={
                    submitted
                      ? (
                        <span className="debug-result-summary">
                          <span>任务名称：{taskName}</span>
                          <span>任务编号：{submitted.taskUuid}</span>
                        </span>
                      )
                      : "后端已接受本次运行"
                  }
                />
                <Space className="debug-result-actions">
                  <Button type="primary" onClick={() => onNavigate("tasks")}>
                    查看任务
                  </Button>
                  <Button onClick={onBack}>返回工作流</Button>
                </Space>
                <pre className="schema-block-pre">
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
