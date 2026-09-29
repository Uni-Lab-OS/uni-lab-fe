import { describe, expect, it } from "vitest";
import type { TaskRuntimePresentation } from "@unilab-fe/core";
import { formatDateTime, taskDisplayName, workflowDisplayName } from "./taskPresentation";

const task = (raw: Readonly<Record<string, unknown>>): TaskRuntimePresentation => ({
  kind: "task_runtime_presentation",
  source: "os",
  taskUuid: "task-1",
  workflowUuid: "workflow-1",
  executionKind: "workflow",
  status: "running",
  runMode: "normal",
  controlStatus: "open",
  cleanupStatus: "pending",
  priority: "normal",
  description: null,
  createdAt: "2026-09-24T05:23:58.676408Z",
  updatedAt: "2026-09-24T05:23:58.676408Z",
  finishedAt: null,
  attentionReason: null,
  progress: null,
  raw,
  jobs: [],
});

describe("task presentation", () => {
  it("uses task and workflow business names from the runtime snapshot", () => {
    const value = task({
      description: "物料转运调试",
      workflow_snapshot: { workflow: { name: "SZLab 标准物料转运" } },
    });
    expect(taskDisplayName(value)).toBe("物料转运调试");
    expect(workflowDisplayName(value)).toBe("SZLab 标准物料转运");
  });

  it("formats timestamps as local YYYY-MM-DD HH:mm:ss", () => {
    expect(formatDateTime("2026-09-24T05:23:58.676408Z")).toMatch(
      /^2026-09-24 \d{2}:23:58$/,
    );
  });
});
