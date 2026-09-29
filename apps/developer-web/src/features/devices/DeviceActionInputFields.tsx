import { Form, Input, InputNumber, Select, Switch, Tooltip } from "antd";
import type { ReactNode } from "react";
import {
  isDeviceActionResourceParameter,
  isDeviceActionStructuredParameter,
} from "@unilab-fe/core";
import type { DeviceActionParameter } from "@unilab-fe/core";
import { AppIcon } from "../../components/ui/Icon";

export {
  deviceActionDefaults,
  deviceActionParameters,
  deviceActionParametersFromSchema,
  normalizeDeviceActionParameters,
} from "@unilab-fe/core";

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
  if (isDeviceActionResourceParameter(parameter)) {
    return (
      <Form.Item {...itemProps}>
        <Input readOnly={!editable} placeholder="输入资源 UUID" />
      </Form.Item>
    );
  }
  if (isDeviceActionStructuredParameter(parameter)) {
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

function schemaType(schema: Readonly<Record<string, unknown>>): string | undefined {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type)) {
    return schema.type.find((item): item is string => typeof item === "string" && item !== "null");
  }
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
