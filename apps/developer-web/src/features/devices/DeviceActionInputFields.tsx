import { Form, Input, InputNumber, Select, Switch, Tooltip } from "antd";
import type { ReactNode } from "react";
import type { ActionDefinition } from "@unilab-fe/core";
import { AppIcon } from "../../components/ui/Icon";

export interface DeviceActionParameter {
  readonly name: string;
  readonly schema: Readonly<Record<string, unknown>>;
  readonly required: boolean;
  readonly title: string;
  readonly description?: string;
  readonly defaultValue?: unknown;
}

/** 将设备包的 action schema 与 handles 合并为稳定的表单参数顺序。 */
export function deviceActionParameters(
  definition?: ActionDefinition,
): readonly DeviceActionParameter[] {
  if (!definition) return [];
  return buildDeviceActionParameters(
    definition.schema,
    definition.goalDefault,
    definition.handles.filter(
      (handle) => handle.ioType === "target" && handle.dataSource === "goal",
    ),
  );
}

/** 设备目录没有对应 workflow-node-template 时，使用设备包下发的 inputSchema。 */
export function deviceActionParametersFromSchema(
  schema: Readonly<Record<string, unknown>>,
): readonly DeviceActionParameter[] {
  return buildDeviceActionParameters(schema, {}, []);
}

function buildDeviceActionParameters(
  schema: Readonly<Record<string, unknown>>,
  goalDefault: Readonly<Record<string, unknown>>,
  handles: readonly {
    readonly handleKey: string;
    readonly displayName: string;
    readonly required: boolean;
    readonly valueSchema: Readonly<Record<string, unknown>>;
  }[],
): readonly DeviceActionParameter[] {
  const properties = asRecord(schema.properties) ?? {};
  const required = new Set(stringArray(schema.required));
  const orderedNames = [
    ...handles.map((handle) => handle.handleKey),
    ...Object.keys(properties),
  ].filter((name, index, names) => names.indexOf(name) === index);

  return orderedNames.map((name) => {
    const handle = handles.find((item) => item.handleKey === name);
    const parameterSchema = {
      ...(handle?.valueSchema ?? {}),
      ...(asRecord(properties[name]) ?? {}),
    };
    const defaultValue = Object.prototype.hasOwnProperty.call(goalDefault, name)
      ? goalDefault[name]
      : parameterSchema.default;
    return {
      name,
      schema: parameterSchema,
      required: required.has(name) || handle?.required === true,
      title: stringValue(parameterSchema.title) ?? handle?.displayName ?? name,
      description: stringValue(parameterSchema.description),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    };
  });
}

export function deviceActionDefaults(
  parameters: readonly DeviceActionParameter[],
): Record<string, unknown> {
  return Object.fromEntries(
    parameters
      .filter((parameter) => parameter.defaultValue !== undefined)
      .map((parameter) => [parameter.name, formValue(parameter, parameter.defaultValue)]),
  );
}

/** 将表单值还原成 OS action run 所需的 goal 对象。 */
export function normalizeDeviceActionParameters(
  values: Readonly<Record<string, unknown>>,
  parameters: readonly DeviceActionParameter[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const parameter of parameters) {
    if (!Object.prototype.hasOwnProperty.call(values, parameter.name)) {
      if (parameter.required) throw new Error(`请输入${parameter.title}`);
      continue;
    }
    const value = values[parameter.name];
    if (value === undefined || value === null || value === "") {
      if (parameter.required) {
        throw new Error(`请输入${parameter.title}`);
      }
      continue;
    }
    if (isResourceParameter(parameter)) {
      result[parameter.name] = typeof value === "string" ? { uuid: value.trim() } : value;
      continue;
    }
    if (isStructuredParameter(parameter)) {
      if (typeof value !== "string") {
        result[parameter.name] = value;
        continue;
      }
      try {
        result[parameter.name] = JSON.parse(value) as unknown;
      } catch {
        throw new Error(`参数“${parameter.title}”必须是合法 JSON`);
      }
      continue;
    }
    result[parameter.name] = value;
  }
  return result;
}

export function DeviceActionInputFields({
  parameters,
  editable = true,
}: {
  readonly parameters: readonly DeviceActionParameter[];
  readonly editable?: boolean;
}) {
  if (parameters.length === 0) {
    return <div className="device-action-input-empty">该动作没有声明可填写的参数。</div>;
  }
  return (
    <div className="device-action-input-fields">
      {parameters.map((parameter) => {
        const field = (
          <DeviceActionInputField
            parameter={parameter}
            editable={editable}
          />
        );
        return editable ? (
          <div className="device-action-field-slot" key={parameter.name}>
            {field}
          </div>
        ) : (
          <ReadOnlyFieldTooltip key={parameter.name}>
            {field}
          </ReadOnlyFieldTooltip>
        );
      })}
    </div>
  );
}

export function ReadOnlyFieldTooltip({ children }: { readonly children: ReactNode }) {
  return <div className="device-action-readonly-field">{children}</div>;
}

function DeviceActionInputField({
  parameter,
  editable,
}: {
  readonly parameter: DeviceActionParameter;
  readonly editable: boolean;
}) {
  const itemProps = {
    label: <ParameterLabel parameter={parameter} />,
    name: parameter.name,
    rules: parameter.required
      ? [{ required: true, message: `请输入${parameter.title}` }]
      : undefined,
  };
  const enumValues = Array.isArray(parameter.schema.enum) ? parameter.schema.enum : null;

  if (enumValues) {
    return (
      <Form.Item {...itemProps}>
        <Select
          disabled={!editable}
          allowClear={!parameter.required}
          options={enumValues.map((value) => ({ label: String(value), value: value as string | number | boolean }))}
          placeholder={`请选择${parameter.title}`}
        />
      </Form.Item>
    );
  }
  const type = schemaType(parameter.schema);
  if (type === "boolean") {
    return (
      <Form.Item {...itemProps} valuePropName="checked">
        <Switch disabled={!editable} />
      </Form.Item>
    );
  }
  if (type === "number" || type === "integer") {
    return (
      <Form.Item {...itemProps}>
        <InputNumber
          className="full-input"
          min={numberValue(parameter.schema.minimum)}
          max={numberValue(parameter.schema.maximum)}
          step={type === "integer" ? 1 : undefined}
          readOnly={!editable}
          placeholder={`请输入${parameter.title}`}
        />
      </Form.Item>
    );
  }
  if (isResourceParameter(parameter)) {
    return (
      <Form.Item {...itemProps}>
        <Input readOnly={!editable} placeholder="输入资源 UUID" />
      </Form.Item>
    );
  }
  if (isStructuredParameter(parameter)) {
    return (
      <Form.Item {...itemProps}>
        <Input.TextArea
          readOnly={!editable}
          autoSize={{ minRows: 3, maxRows: 8 }}
          placeholder="请输入 JSON"
        />
      </Form.Item>
    );
  }
  return (
    <Form.Item {...itemProps}>
      <Input readOnly={!editable} placeholder={`请输入${parameter.title}`} />
    </Form.Item>
  );
}

function ParameterLabel({ parameter }: { readonly parameter: DeviceActionParameter }) {
  return (
    <span className="device-action-input-label">
      <span>{parameter.title}</span>
      {parameter.title !== parameter.name && <code>{parameter.name}</code>}
      {parameter.description ? (
        <Tooltip
          title={parameter.description}
          align={{ offset: [0, 0] }}
        >
          <span
            className="device-action-help-icon"
            aria-label={`${parameter.title}说明`}
          >
            <AppIcon name="general/help-circle" size={14} />
          </span>
        </Tooltip>
      ) : null}
    </span>
  );
}

function isResourceParameter(parameter: DeviceActionParameter): boolean {
  return parameter.schema.$slot === "ResourceSlot"
    || parameter.schema["x-unilabos-material-lock"] === true;
}

function isStructuredParameter(parameter: DeviceActionParameter): boolean {
  const type = schemaType(parameter.schema);
  return type === "object" || type === "array";
}

function schemaType(schema: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) {
    return schema.type.find((item): item is string => typeof item === "string" && item !== "null");
  }
  return undefined;
}

function formValue(parameter: DeviceActionParameter, value: unknown): unknown {
  if (isResourceParameter(parameter)) {
    const record = asRecord(value);
    return record && typeof record.uuid === "string" ? record.uuid : value;
  }
  if (isStructuredParameter(parameter) && typeof value === "object" && value !== null) {
    return JSON.stringify(value, null, 2);
  }
  return value;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
