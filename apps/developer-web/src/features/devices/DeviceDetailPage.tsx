import { cx } from "../../styles/styleMaps";
import {
  Alert,
  Button,
  Descriptions,
  Form,
  Input,
  Segmented,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  deviceDispatchStatus,
  deviceOccupancyStatus,
  createDeviceActionDebuggingViewModel,
} from "@unilab-fe/core";
import type {
  ActionDefinition,
  DeviceActionState,
  DeviceSummary,
} from "@unilab-fe/core";
import {
  DeviceActionList,
  DeviceActionParameterFields,
} from "@unilab/lab-ui";
import { useBackend } from "../../app/BackendProvider";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import { AppIcon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import {
  deviceActionDefaults,
  deviceActionParameters,
  deviceActionParametersFromSchema,
  normalizeDeviceActionParameters,
  ReadOnlyFieldTooltip,
} from "./DeviceActionInputFields";

export function DeviceDetail({
  device,
  startDebug = false,
  onBack,
}: {
  device: DeviceSummary;
  startDebug?: boolean;
  onBack: () => void;
}) {
  const { backend } = useBackend();
  const [selectedAction, setSelectedAction] =
    useState<DeviceActionState | null>(device.actions[0] ?? null);
  const [debugEditing, setDebugEditing] = useState(false);
  const [parameterView, setParameterView] = useState<"form" | "schema">("form");
  const [accepted, setAccepted] = useState<{
    taskUuid: string;
    jobUuid: string;
  } | null>(null);
  const autoOpenedDebug = useRef(false);
  const selectedActionUuid = selectedAction?.actionDefinitionUuid ?? "";
  const definitionQuery = useBackendQuery(
    `action-definition-${selectedActionUuid}`,
    (current) =>
      selectedActionUuid
        ? current.core.deviceActions.getActionDefinition(selectedActionUuid)
        : Promise.resolve(undefined),
  );
  const actionDefinition = definitionQuery.data;
  const occupancyStatus = deviceOccupancyStatus(device);
  const actionParameters = useMemo(() => {
    const defined = deviceActionParameters(actionDefinition);
    if (defined.length || actionDefinition) return defined;
    const rawSchema = selectedAction?.raw.inputSchema ?? selectedAction?.raw.input_schema;
    return isRecord(rawSchema) ? deviceActionParametersFromSchema(rawSchema) : [];
  }, [actionDefinition, selectedAction]);
  useEffect(() => {
    if (
      startDebug &&
      !autoOpenedDebug.current &&
      selectedAction
    ) {
      autoOpenedDebug.current = true;
      setDebugEditing(true);
      setParameterView("form");
    }
  }, [selectedAction, startDebug]);
  useEffect(() => {
    setDebugEditing(false);
    setParameterView("form");
  }, [selectedActionUuid]);
  return (
    <div className={cx("page-stack device-detail-page")}>
      <PageHeader
        title={
          <span className={cx("device-detail-title")}>
            <Tooltip title={device.label} placement="bottomLeft">
              <span className={cx("device-detail-title__name")}>{device.label}</span>
            </Tooltip>
            <Tag
              color={
                device.online === false
                  ? "default"
                  : device.online === true
                    ? "success"
                    : undefined
              }
            >
              {device.online === false ? "离线" : device.online === true ? "在线" : "连接未知"}
            </Tag>
            <Tag
              color={
                occupancyStatus === "occupied"
                  ? "warning"
                  : occupancyStatus === "idle"
                    ? "processing"
                    : "default"
              }
            >
              {occupancyStatus === "occupied"
                ? "占用"
                : occupancyStatus === "idle"
                  ? "空闲"
                  : "占用未知"}
            </Tag>
          </span>
        }
        leading={
          <Button
            className={cx("page-header-back")}
            type="text"
            aria-label="返回设备"
            icon={<AppIcon name="arrows/arrow-left" size={18} />}
            onClick={onBack}
          />
        }
      />
      <div className={cx("detail-columns")}>
        <section className={cx("detail-sidebar")}>
          <div className={cx("section-title")}>
            <h2>动作</h2>
            <span>{device.actions.length} 个动作</span>
          </div>
          <DeviceActionList
            actions={device.actions}
            selectedActionRef={selectedAction?.actionRef}
            onSelectAction={(action) => {
              setSelectedAction(action);
              setAccepted(null);
              setDebugEditing(false);
              setParameterView("form");
            }}
          />
        </section>
        <section className={cx("detail-main")}>
          <div className={cx("section-title detail-main__action-heading")}>
            <div>
              <Tooltip title={selectedAction?.label} placement="topLeft">
                <span className={cx("action-detail-title")}>
                  {selectedAction?.label ?? "未选择动作"}
                </span>
              </Tooltip>
            </div>
            <Space size={8}>
              {selectedAction?.isBusy && <StatusBadge status="running" />}
              <Button
                className={cx("detail-main__debug-button")}
                type={debugEditing ? "default" : "primary"}
                disabled={!selectedAction}
                icon={
                  <AppIcon
                    name={debugEditing ? "arrows/arrow-left" : "general/tool-01"}
                    color="inherit"
                    size={16}
                  />
                }
                onClick={() => {
                  setAccepted(null);
                  setDebugEditing((value) => !value);
                  setParameterView("form");
                }}
              >
                {debugEditing ? "退出调试" : "调试动作"}
              </Button>
            </Space>
          </div>
          {definitionQuery.loading && !actionDefinition && actionParameters.length === 0 ? (
            <Typography.Text type="secondary">
              正在读取动作定义...
            </Typography.Text>
          ) : definitionQuery.error && actionParameters.length === 0 ? (
            <Alert
              type="error"
              showIcon
              message="动作定义读取失败"
              description={definitionQuery.error.message}
            />
          ) : selectedAction ? (
            <div
              className={cx(`definition-view-shell ${definitionQuery.loading ? "is-loading" : ""}`)}
              aria-busy={definitionQuery.loading}
            >
              {definitionQuery.loading && (
                <span className={cx("definition-view-shell__loading")}>
                  <Spin size="small" /> 更新中
                </span>
              )}
              {definitionQuery.error && (
                <Alert
                  type="warning"
                  showIcon
                  message="动作定义读取失败"
                  description={`${definitionQuery.error.message}，当前先展示设备包参数。`}
                  style={{ marginBottom: 18 }}
                />
              )}
              <ActionDefinitionMeta
                definition={actionDefinition}
              />
              <div className={cx("action-parameter-toolbar")}>
                <Segmented
                  size="middle"
                  value={parameterView}
                  disabled={debugEditing}
                  onChange={(value) => setParameterView(value as "form" | "schema")}
                  options={[
                    { label: "参数", value: "form" },
                    { label: "Schema", value: "schema" },
                  ]}
                />
                {debugEditing && (
                  <Typography.Text type="secondary">
                    调试模式：参数可编辑
                  </Typography.Text>
                )}
              </div>
              {parameterView === "schema" ? (
                <ActionSchemaView
                  definition={actionDefinition}
                  fallbackSchema={
                    isRecord(selectedAction?.raw.inputSchema)
                      ? selectedAction?.raw.inputSchema
                      : isRecord(selectedAction?.raw.input_schema)
                        ? selectedAction?.raw.input_schema
                        : undefined
                  }
                />
              ) : (
                <DeviceActionEditor
                  action={selectedAction}
                  device={device}
                  parameters={actionParameters}
                  editing={debugEditing}
                  onCancel={() => setDebugEditing(false)}
                  onAccepted={(result) => {
                    setAccepted(result);
                    setDebugEditing(false);
                  }}
                />
              )}
            </div>
          ) : (
            <Typography.Text type="secondary">当前设备没有动作</Typography.Text>
          )}
          {accepted && (
            <Alert
              className={cx("accepted-result")}
              type="info"
              showIcon
              message="调试命令已被 OS 接受"
              description={`Task ${accepted.taskUuid} / Job ${accepted.jobUuid}。接受不代表动作已经完成，请在任务页面读取运行状态。`}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function ActionDefinitionMeta({
  definition,
}: {
  definition?: ActionDefinition;
}) {
  if (!definition) {
    return (
      <Alert
        type="warning"
        showIcon
        message="当前动作没有同步动作定义"
        description="参数仍按设备包 schema 展示，但 OS 没有返回可执行的动作定义。"
        style={{ marginBottom: 18 }}
      />
    );
  }
  return (
    <Descriptions className={cx("definition-meta")} column={2} size="small" colon={false}>
      <Descriptions.Item label="动作类型">{definition.actionType}</Descriptions.Item>
      <Descriptions.Item label="节点类型">{definition.nodeType}</Descriptions.Item>
      <Descriptions.Item label="动作类" span={2}>
        {definition.actionClass ?? "未提供"}
      </Descriptions.Item>
    </Descriptions>
  );
}

function ActionSchemaView({
  definition,
  fallbackSchema,
}: {
  definition?: ActionDefinition;
  fallbackSchema?: Readonly<Record<string, unknown>>;
}) {
  const schema = definition?.schema ?? fallbackSchema;
  const [copied, setCopied] = useState(false);
  if (!schema) {
    return <Typography.Text type="secondary">当前动作没有返回 schema。</Typography.Text>;
  }
  const schemaText = JSON.stringify(schema, null, 2);
  const copySchema = async () => {
    try {
      await navigator.clipboard.writeText(schemaText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className={cx("schema-block")}>
      <div className={cx("schema-block__header")}>
        <span>Schema</span>
        <Tooltip title={copied ? "已复制" : "复制 Schema"}>
          <Button
            type="text"
            size="small"
            className={cx("schema-block__copy")}
            aria-label="复制 Schema"
            icon={<AppIcon name="general/copy-01" size={14} />}
            onClick={copySchema}
          />
        </Tooltip>
      </div>
      <pre>{schemaText}</pre>
    </div>
  );
}

function DeviceMaterialLabel() {
  return (
    <span className={cx("device-action-input-label")}>
      <span>设备物料 UUID</span>
      <Tooltip
        title="动作任务绑定的当前设备资源"
        align={{ offset: [0, 0] }}
      >
        <span className={cx("device-action-help-icon")} aria-label="设备物料 UUID 说明">
          <AppIcon name="general/help-circle" size={14} />
        </span>
      </Tooltip>
    </span>
  );
}

function DeviceActionEditor({
  device,
  action,
  parameters,
  editing,
  onCancel,
  onAccepted,
}: {
  device: DeviceSummary;
  action: DeviceActionState | null;
  parameters: ReturnType<typeof deviceActionParameters>;
  editing: boolean;
  onCancel: () => void;
  onAccepted: (result: { taskUuid: string; jobUuid: string }) => void;
}) {
  const { backend } = useBackend();
  const [form] = Form.useForm<{
    materialUuid: string;
    [key: string]: unknown;
    description?: string;
  }>();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({});
  useEffect(() => {
    setSubmitError(null);
    setParameterValues(deviceActionDefaults(parameters));
    form.resetFields();
    form.setFieldsValue({ materialUuid: device.materialUuid });
  }, [action?.actionRef, device.materialUuid, form, parameters]);
  useEffect(() => {
    if (editing) return;
    setParameterValues(deviceActionDefaults(parameters));
    form.resetFields();
    form.setFieldsValue({ materialUuid: device.materialUuid });
    setSubmitError(null);
  }, [device.materialUuid, editing, form, parameters]);
  const submit = async (values: {
    materialUuid: string;
    [key: string]: unknown;
    description?: string;
  }) => {
    if (
      !editing ||
      deviceDispatchStatus(device) !== "available" ||
      !action?.actionDefinitionUuid
    ) return;
    let param: Record<string, unknown>;
    try {
      param = normalizeDeviceActionParameters(
        { ...values, ...parameterValues },
        parameters,
      );
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "动作参数无效");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const viewModel = createDeviceActionDebuggingViewModel({}, [], []);
      const nextViewModel = await backend.core.deviceActionDebugging.startRun(
        viewModel,
        {
          materialUuid: values.materialUuid,
          workflowNodeTemplateUuid: action.actionDefinitionUuid,
          param,
          idempotencyKey: crypto.randomUUID(),
          description: values.description,
        },
      );
      const acceptedRun = nextViewModel.acceptedRun;
      if (!acceptedRun) throw new Error("OS 未返回已接受的动作任务");
      onAccepted({ taskUuid: acceptedRun.taskUuid, jobUuid: acceptedRun.jobUuid });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "调试命令发送失败");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className={cx(`device-action-editor ${editing ? "is-editing" : ""}`)}>
      {submitError ? (
        <Alert
          type="error"
          showIcon
          message="调试命令发送失败"
          description={submitError}
          style={{ marginBottom: 18 }}
        />
      ) : null}
      {editing && deviceDispatchStatus(device) !== "available" ? (
        <Alert
          type={deviceDispatchStatus(device) === "unknown" ? "warning" : "error"}
          showIcon
          message={
            deviceDispatchStatus(device) === "offline"
              ? "设备当前不在线，不能执行动作。"
              : deviceDispatchStatus(device) === "blocked"
                ? "设备当前不可调度，不能执行动作。"
                : "设备可调度状态未知，不能执行动作。"
          }
          description={device.dispatchBlockReason ?? undefined}
          style={{ marginBottom: 18 }}
        />
      ) : null}
      {!action?.actionDefinitionUuid ? (
        <Alert
          type="info"
          showIcon
          message="动作定义尚未同步"
          description="已展示设备包声明的参数，但当前 OS 没有返回可执行的动作定义，因此暂不能发送。"
          style={{ marginBottom: 18 }}
        />
      ) : null}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          materialUuid: device.materialUuid,
        }}
        onFinish={submit}
      >
        <div className={cx("device-action-form-grid")}>
          {editing ? (
            <Form.Item
              label={<DeviceMaterialLabel />}
              name="materialUuid"
            >
              <Input />
            </Form.Item>
          ) : (
            <ReadOnlyFieldTooltip>
              <Form.Item
                label={<DeviceMaterialLabel />}
                name="materialUuid"
              >
                <Input disabled />
              </Form.Item>
            </ReadOnlyFieldTooltip>
          )}
          <DeviceActionParameterFields
            parameters={parameters}
            value={parameterValues}
            editable={editing}
            className={cx("device-action-input-fields")}
            onChange={(name, next) =>
              setParameterValues((current) => ({ ...current, [name]: next }))
            }
          />
        </div>
        {editing && (
          <Form.Item label="调试说明" name="description">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        )}
        {editing && (
          <div className={cx("action-editor-actions")}>
            <Button onClick={onCancel}>取消编辑</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={
                deviceDispatchStatus(device) !== "available" ||
                !action?.actionDefinitionUuid
              }
              icon={<AppIcon name="media/play" color="white" size={16} />}
            >
              发送调试命令
            </Button>
          </div>
        )}
      </Form>
    </div>
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
