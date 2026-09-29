import { describe, expect, it } from "vitest";
import type { ActionDefinition } from "@unilab-fe/core";
import {
  deviceActionDefaults,
  deviceActionParameters,
  deviceActionParametersFromSchema,
  normalizeDeviceActionParameters,
} from "./DeviceActionInputFields";

function definition(): ActionDefinition {
  return {
    kind: "action_definition",
    source: "fixture",
    actionUuid: "action-1",
    name: "inspect",
    displayName: "Inspect",
    actionType: "UniLabJsonCommand",
    nodeType: "ILab",
    resourceTemplateUuid: "device-1",
    actionClass: null,
    schema: {
      type: "object",
      required: ["beaker"],
      properties: {
        beaker: { type: "object", "x-unilabos-material-lock": true },
        sample_id: { type: "string", default: "sample-01" },
        enabled: { type: "boolean", default: true },
      },
    },
    goal: {},
    goalDefault: { sample_id: "sample-01", enabled: true },
    handles: [
      {
        uuid: "handle-1",
        workflowNodeTemplateUuid: "action-1",
        handleKey: "beaker",
        ioType: "target",
        displayName: "烧杯",
        valueType: "ResourceSlot",
        required: true,
        dataSource: "goal",
        dataKey: "beaker",
        valueSchema: { type: "object", "x-unilabos-material-lock": true },
        editorControl: "material_port",
        allowedResourceTemplateUuids: null,
        implicitPassthrough: false,
        structuralRole: null,
      },
      {
        uuid: "handle-2",
        workflowNodeTemplateUuid: "action-1",
        handleKey: "ready",
        ioType: "target",
        displayName: "ready",
        valueType: "default",
        required: false,
        dataSource: null,
        dataKey: null,
        valueSchema: {},
        editorControl: "variable_selector",
        allowedResourceTemplateUuids: null,
        implicitPassthrough: false,
        structuralRole: null,
      },
    ],
    resourceContract: null,
    raw: {},
  };
}

describe("device action input fields", () => {
  it("uses goal schema parameters and excludes structural handles", () => {
    const parameters = deviceActionParameters(definition());
    expect(parameters.map((parameter) => parameter.name)).toEqual([
      "beaker",
      "sample_id",
      "enabled",
    ]);
    expect(parameters[0]).toMatchObject({ title: "烧杯", required: true });
  });

  it("hydrates defaults and normalizes resource values for OS", () => {
    const parameters = deviceActionParameters(definition());
    expect(deviceActionDefaults(parameters)).toEqual({
      sample_id: "sample-01",
      enabled: true,
    });
    expect(
      normalizeDeviceActionParameters(
        { beaker: "material-1", sample_id: "sample-02", enabled: false },
        parameters,
      ),
    ).toEqual({
      beaker: { uuid: "material-1" },
      sample_id: "sample-02",
      enabled: false,
    });
  });

  it("keeps empty-string and false schema defaults in the form model", () => {
    const parameters = deviceActionParametersFromSchema({
      type: "object",
      properties: {
        sample_id: { type: "string", default: "" },
        require_material: { type: "boolean", default: false },
      },
    });

    expect(deviceActionDefaults(parameters)).toEqual({
      sample_id: "",
      require_material: false,
    });
  });

  it("builds fields from a device package schema when no action definition exists", () => {
    const parameters = deviceActionParametersFromSchema({
      type: "object",
      properties: {
        volume: { type: ["number", "null"], default: 1 },
        unit: { type: "string", title: "体积单位" },
        skip_level_check: { type: "boolean", default: false },
      },
      required: ["volume"],
    });

    expect(parameters).toMatchObject([
      { name: "volume", required: true, defaultValue: 1 },
      { name: "unit", title: "体积单位" },
      { name: "skip_level_check", defaultValue: false },
    ]);
    expect(
      normalizeDeviceActionParameters(
        { volume: 2.5, unit: "uL", skip_level_check: true },
        parameters,
      ),
    ).toEqual({ volume: 2.5, unit: "uL", skip_level_check: true });
  });

  it("rejects missing required and malformed structured values", () => {
    const parameters = deviceActionParametersFromSchema({
      type: "object",
      properties: {
        sample: { type: "object", title: "样品" },
      },
      required: ["sample"],
    });

    expect(() => normalizeDeviceActionParameters({}, parameters)).toThrow("请输入样品");
    expect(() => normalizeDeviceActionParameters({ sample: "{" }, parameters)).toThrow(
      "必须是合法 JSON",
    );
  });
});
