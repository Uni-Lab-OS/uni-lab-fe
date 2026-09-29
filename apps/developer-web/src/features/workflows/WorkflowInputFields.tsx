import { Form, Input, InputNumber, Select, Switch } from "antd";
import type { WorkflowInputParameter } from "@unilab-fe/core";

interface WorkflowInputFieldsProps {
  readonly parameters: readonly WorkflowInputParameter[];
}

/** 将领域模型中的默认值转换成表单控件可以编辑的值。 */
export function workflowInputDefaults(
  parameters: readonly WorkflowInputParameter[],
): Record<string, unknown> {
  return Object.fromEntries(
    parameters
      .filter((parameter) => parameter.defaultValue !== undefined)
      .map((parameter) => [
        parameter.name,
        formValue(parameter, parameter.defaultValue),
      ]),
  );
}

/** 将 Ant Design 表单值还原成 run preparation 需要的工作流入参对象。 */
export function normalizeWorkflowInput(
  values: Readonly<Record<string, unknown>>,
  parameters: readonly WorkflowInputParameter[],
): Record<string, unknown> {
  const raw = asRecord(values.workflowInput) ?? values;
  const result: Record<string, unknown> = {};
  for (const parameter of parameters) {
    if (!Object.prototype.hasOwnProperty.call(raw, parameter.name)) continue;
    const value = raw[parameter.name];
    if (value === undefined || value === null || value === "") continue;
    if (parameter.schema.$slot === "ResourceSlot") {
      result[parameter.name] =
        typeof value === "string" ? { uuid: value.trim() } : value;
      continue;
    }
    if (
      typeof value === "string" &&
      (parameter.schema.type === "object" || parameter.schema.type === "array")
    ) {
      try {
        result[parameter.name] = JSON.parse(value) as unknown;
      } catch {
        throw new Error(`参数“${parameterLabel(parameter)}”必须是合法 JSON`);
      }
      continue;
    }
    result[parameter.name] = value;
  }
  return result;
}

export function WorkflowInputFields({
  parameters,
}: WorkflowInputFieldsProps) {
  if (parameters.length === 0) {
    return (
      <div className="workflow-input-empty">
        该工作流没有声明需要填写的运行参数。
      </div>
    );
  }

  return (
    <div className="workflow-input-fields">
      {parameters.map((parameter) => (
        <WorkflowInputField key={parameter.name} parameter={parameter} />
      ))}
    </div>
  );
}

function WorkflowInputField({
  parameter,
}: {
  readonly parameter: WorkflowInputParameter;
}) {
  const schema = parameter.schema;
  const label = parameterLabel(parameter);
  const itemProps = {
    label: <ParameterLabel parameter={parameter} />,
    name: ["workflowInput", parameter.name],
    rules: parameter.required
      ? [{ required: true, message: `请输入${label}` }]
      : undefined,
    extra: parameter.description,
  };
  const enumValues = Array.isArray(schema.enum) ? schema.enum : null;

  if (enumValues) {
    return (
      <Form.Item {...itemProps}>
        <Select
          showSearch
          optionFilterProp="label"
          allowClear={!parameter.required}
          options={enumValues.map((value) => ({
            label: String(value),
            value: value as string | number | boolean,
          }))}
          placeholder={`请选择${label}`}
        />
      </Form.Item>
    );
  }

  if (schema.type === "boolean") {
    return (
      <Form.Item {...itemProps} valuePropName="checked">
        <Switch />
      </Form.Item>
    );
  }

  if (schema.type === "number" || schema.type === "integer") {
    return (
      <Form.Item {...itemProps}>
        <InputNumber
          className="full-input"
          min={numberValue(schema.minimum)}
          max={numberValue(schema.maximum)}
          step={schema.type === "integer" ? 1 : undefined}
          placeholder={`请输入${label}`}
        />
      </Form.Item>
    );
  }

  if (schema.$slot === "ResourceSlot") {
    return (
      <Form.Item {...itemProps}>
        <Input placeholder="输入资源 UUID" />
      </Form.Item>
    );
  }

  if (schema.type === "object" || schema.type === "array") {
    return (
      <Form.Item {...itemProps}>
        <Input.TextArea
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="请输入 JSON"
        />
      </Form.Item>
    );
  }

  return (
    <Form.Item {...itemProps}>
      <Input placeholder={`请输入${label}`} />
    </Form.Item>
  );
}

function ParameterLabel({
  parameter,
}: {
  readonly parameter: WorkflowInputParameter;
}) {
  return (
    <span className="workflow-input-label">
      <span>{parameterLabel(parameter)}</span>
      <code>{parameter.name}</code>
    </span>
  );
}

function parameterLabel(parameter: WorkflowInputParameter): string {
  return parameter.title || parameter.name;
}

function formValue(
  parameter: WorkflowInputParameter,
  value: unknown,
): unknown {
  if (parameter.schema.$slot === "ResourceSlot") {
    const record = asRecord(value);
    return record && typeof record.uuid === "string" ? record.uuid : value;
  }
  if (
    (parameter.schema.type === "object" || parameter.schema.type === "array") &&
    typeof value === "object" &&
    value !== null
  ) {
    return JSON.stringify(value, null, 2);
  }
  return value;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
