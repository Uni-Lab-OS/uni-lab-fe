import { describe, expect, it } from "vitest"
import type { WorkflowNodeJobDetail } from "@unilab-fe/core"
import type { WorkflowResourceWaitFact } from "@unilab-fe/core"
import { hasWorkflowSiteFact, readExpectedChangeSetKind } from "./TaskDetailPage"

const job = (raw: Readonly<Record<string, unknown>>): WorkflowNodeJobDetail => ({
  kind: "node_job_detail",
  source: "os",
  jobUuid: "job-1",
  workflowTaskUuid: "task-1",
  workflowNodeUuid: "node-1",
  materialUuid: null,
  edgeUuid: null,
  edgeCommandUuid: null,
  feedbackSequence: null,
  topologicalIndex: 0,
  executorKind: "device",
  executionPolicy: {},
  executionTimeoutSeconds: null,
  status: "pending",
  attempt: 1,
  param: {},
  feedbackData: {},
  returnInfo: {},
  controlData: {},
  errorInfo: [],
  uncertaintyReason: null,
  dispatchDeadlineAt: null,
  executionDeadlineAt: null,
  cancelCommandUuid: null,
  cancelAckDeadlineAt: null,
  cancelCompleteDeadlineAt: null,
  startedAt: null,
  finishedAt: null,
  raw,
})

describe("task detail resource facts", () => {
  it("does not throw when detail responses omit expected_change_set", () => {
    expect(readExpectedChangeSetKind(job({}))).toBeNull()
    expect(readExpectedChangeSetKind(null)).toBeNull()
  })

  it("reads the change kind from the raw OS projection", () => {
    expect(readExpectedChangeSetKind(job({ expected_change_set: { kind: "no_inventory_change" } }))).toBe("no_inventory_change")
  })

  it("does not expose a site map for no_inventory_change device actions", () => {
    const detail = job({ expected_change_set: { kind: "no_inventory_change" } })

    expect(hasWorkflowSiteFact(detail, [])).toBe(false)
  })

  it("exposes the site map only when OS returns an explicit Site fact", () => {
    const detail = job({ expected_change_set: { kind: "material_transfer", target_site_uuid: "site-s061" } })
    const siteWait: WorkflowResourceWaitFact = {
      resourceUuid: "site-s062",
      resourceKind: "site",
      reason: "occupied",
      blocking: true,
      raw: {},
    }

    expect(hasWorkflowSiteFact(detail, [])).toBe(true)
    expect(hasWorkflowSiteFact(job({}), [siteWait])).toBe(true)
  })

  it("reads a nested dispatch expected_change_set without throwing", () => {
    const detail = {
      ...job({}),
      controlData: { dispatch_payload: { expected_change_set: { kind: "material_transfer", source_site_uuid: "site-source" } } },
    }

    expect(readExpectedChangeSetKind(detail)).toBe("material_transfer")
    expect(hasWorkflowSiteFact(detail, [])).toBe(true)
  })
})
