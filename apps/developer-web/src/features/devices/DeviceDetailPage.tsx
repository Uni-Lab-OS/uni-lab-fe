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
import type {
  ActionDefinition,
  DeviceActionState,
  DeviceSummary,
} from "@unilab-fe/core";
import { useBackend } from "../../app/BackendProvider";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import { AppIcon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import {
  DeviceActionInputFields,
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
  const hasOccupancy =
    device.actions.some((action) => action.isBusy === true) ||
    (device.executionOccupancies?.length ?? 0) > 0;
  const occupancyKnown = device.actions.every((action) => action.busyStatusKnown);
  const occupancyStatus = hasOccupancy
    ? "occupied"
    : occupancyKnown
      ? "idle"
      : "unknown";
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
    <div className="page-stack device-detail-page">
      <PageHeader
        title={
          <span className="device-detail-title">
            <Tooltip title={device.label} placement="bottomLeft">
              <span className="device-detail-title__name">{device.label}</span>
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
            className="page-header-back"
            type="text"
            aria-label="返回设备"
            icon={<AppIcon name="arrows/arrow-left" size={18} />}
            onClick={onBack}
          />
        }
      />
      <div className="detail-columns">
        <section className="detail-sidebar">
          <div className="section-title">
            <h2>动作</h2>
            <span>{device.actions.length} 个动作</span>
          </div>
          {device.actions.length === 0 ? (
            <Typography.Text type="secondary">设备没有可用动作</Typography.Text>
          ) : (
            device.actions.map((action) => (
              <button
                type="button"
                key={action.actionRef}
                className={`action-item ${selectedAction?.actionRef === action.actionRef ? "is-selected" : ""}`}
                onClick={() => {
                  setSelectedAction(action);
                  setAccepted(null);
                  setDebugEditing(false);
                  setParameterView("form");
                }}
              >
                <Tooltip title={action.label} placement="right">
                  <span className="action-item-label">
                    <strong>{action.label}</strong>
                  </span>
                </Tooltip>
                {action.isBusy && <Tag color="processing">执行中</Tag>}
              </button>
            ))
          )}
        </section>
        <section className="detail-main">
          <div className="section-title detail-main__action-heading">
            <div>
              <Tooltip title={selectedAction?.label} placement="topLeft">
                <span className="action-detail-title">
                  {selectedAction?.label ?? "未选择动作"}
                </span>
              </Tooltip>
            </div>
            <Space size={8}>
              {selectedAction?.isBusy && <StatusBadge status="running" />}
              <Button
                className="detail-main__debug-button"
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
              className={`definition-view-shell ${definitionQuery.loading ? "is-loading" : ""}`}
              aria-busy={definitionQuery.loading}
            >
              {definitionQuery.loading && (
                <span className="definition-view-shell__loading">
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
              <div className="action-parameter-toolbar">
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
              className="accepted-result"
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
    <Descriptions className="definition-meta" column={2} size="small" colon={false}>
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
    <div className="schema-block">
      <div className="schema-block__header">
        <span>Schema</span>
        <Tooltip title={copied ? "已复制" : "复制 Schema"}>
          <Button
            type="text"
            size="small"
            className="schema-block__copy"
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
    <span className="device-action-input-label">
      <span>设备物料 UUID</span>
      <Tooltip
        title="动作任务绑定的当前设备资源"
        align={{ offset: [0, 0] }}
      >
        <span className="device-action-help-icon" aria-label="设备物料 UUID 说明">
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
  useEffect(() => {
    setSubmitError(null);
    form.resetFields();
    form.setFieldsValue({
      materialUuid: device.materialUuid,
      ...deviceActionDefaults(parameters),
    });
  }, [action?.actionRef, device.materialUuid, form, parameters]);
  useEffect(() => {
    if (editing) return;
    form.resetFields();
    form.setFieldsValue({
      materialUuid: device.materialUuid,
      ...deviceActionDefaults(parameters),
    });
    setSubmitError(null);
  }, [device.materialUuid, editing, form, parameters]);
  const submit = async (values: {
    materialUuid: string;
    [key: string]: unknown;
    description?: string;
  }) => {
    if (!editing || device.online === false || !action?.actionDefinitionUuid) return;
    let param: Record<string, unknown>;
    try {
      param = normalizeDeviceActionParameters(values, parameters);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "动作参数无效");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await backend.core.deviceActions.createActionRun({
        materialUuid: values.materialUuid,
        workflowNodeTemplateUuid: action.actionDefinitionUuid,
        param,
        idempotencyKey: crypto.randomUUID(),
        description: values.description,
      });
      onAccepted({ taskUuid: result.taskUuid, jobUuid: result.jobUuid });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "调试命令发送失败");
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <div className={`device-action-editor ${editing ? "is-editing" : ""}`}>
      {submitError ? (
        <Alert
          type="error"
          showIcon
          message="调试命令发送失败"
          description={submitError}
          style={{ marginBottom: 18 }}
        />
      ) : null}
      {editing && device.online === false ? (
        <Alert
          type="error"
          showIcon
          message="设备当前不在线，不能执行动作。"
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
          ...deviceActionDefaults(parameters),
        }}
        onFinish={submit}
      >
        <div className="device-action-form-grid">
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
          <DeviceActionInputFields parameters={parameters} editable={editing} />
        </div>
        {editing && (
          <Form.Item label="调试说明" name="description">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        )}
        {editing && (
          <div className="action-editor-actions">
            <Button onClick={onCancel}>取消编辑</Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={submitting}
              disabled={device.online === false || !action?.actionDefinitionUuid}
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
