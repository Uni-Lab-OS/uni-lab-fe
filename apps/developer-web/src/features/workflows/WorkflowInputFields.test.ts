import { describe, expect, it } from "vitest";
import type { WorkflowInputParameter } from "@unilab-fe/core";
import {
  normalizeWorkflowInput,
  workflowInputDefaults,
} from "./WorkflowInputFields";

const parameters: readonly WorkflowInputParameter[] = [
  {
    name: "resource",
    required: true,
    schema: { $slot: "ResourceSlot" },
  },
  {
    name: "enabled",
    required: false,
    defaultValue: true,
    schema: { type: "boolean" },
  },
  {
    name: "options",
    required: false,
    schema: { type: "object" },
  },
];

describe("workflow input fields", () => {
  it("projects declared defaults into form values", () => {
    expect(workflowInputDefaults(parameters)).toEqual({ enabled: true });
  });

  it("normalizes resource slots and JSON fields for run preparation", () => {
    expect(
      normalizeWorkflowInput(
        {
          workflowInput: {
            resource: "material-1",
            enabled: false,
            options: '{"mode":"safe"}',
          },
        },
        parameters,
      ),
    ).toEqual({
      resource: { uuid: "material-1" },
      enabled: false,
      options: { mode: "safe" },
    });
  });
});
