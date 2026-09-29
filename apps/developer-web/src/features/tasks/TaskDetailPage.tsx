import {
  Alert,
  Descriptions,
  Empty,
  Button,
  Segmented,
  Space,
  Tabs,
  Tag,
  message,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import type {
  NodeJobFeedback,
  TaskJobSummary,
  TaskRuntimeDetail,
  TaskRuntimePresentation,
  WorkflowNodeJobDetail,
} from "@unilab-fe/core";
import type {
  WorkflowTask,
  WorkflowTaskCommandType,
} from "@unilab/services";
import { useBackend } from "../../app/BackendProvider";
import type { StudioRoute } from "../../components/AppShell";
import { AppIcon } from "../../components/ui/Icon";
import { AsyncState } from "../../components/ui/AsyncState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import {
  displayTime,
  jobLabel,
  jobStatus,
  resourceEntries,
  taskNodeNames,
  toTimelineItems,
  type TaskListRow,
} from "./taskDomain";

export function TaskDetail({
  row,
  onBack,
  onNavigate,
}: {
  row: TaskListRow;
  onBack: () => void;
  onNavigate: (route: StudioRoute, search?: string) => void;
}) {
  const { backend } = useBackend();
  const detail = useBackendQuery(
    `task-detail:${row.task.taskUuid}`,
    (current) => current.core.executionRead.getTaskDetail(row.task.taskUuid),
  );
  const jobs = useBackendQuery(`task-jobs:${row.task.taskUuid}`, (current) =>
    current.core.executionRead.listTaskJobs(row.task.taskUuid),
  );
  const runtimeTask = useBackendQuery<WorkflowTask | undefined>(
    `workflow-task:${row.task.taskUuid}`,
    (current) =>
      row.task.executionKind === "workflow"
        ? current.services.workflow.getWorkflowTask(row.task.taskUuid)
        : Promise.resolve(undefined),
  );
  useEffect(() => {
    if (row.task.executionKind !== "workflow") return;

    const refresh = () => {
      if (runtimeTask.data && !["succeeded", "failed", "canceled", "timeout"].includes(runtimeTask.data.status)) {
        runtimeTask.reload();
        detail.reload();
        jobs.reload();
      }
    };
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, [
    row.task.executionKind,
    runtimeTask.data?.status,
    runtimeTask.reload,
    detail.reload,
    jobs.reload,
  ]);
  const [selectedJob, setSelectedJob] = useState<TaskJobSummary | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const jobDetail = useBackendQuery<WorkflowNodeJobDetail | undefined>(
    selectedJob ? `node-job:${selectedJob.jobUuid}` : "node-job:none",
    (current) =>
      selectedJob
        ? current.core.executionRead.getNodeJobDetail(selectedJob.jobUuid)
        : Promise.resolve(undefined),
  );
  const feedback = useBackendQuery<
    | Awaited<ReturnType<typeof backend.core.executionRead.listNodeJobFeedback>>
    | undefined
  >(
    selectedJob ? `node-feedback:${selectedJob.jobUuid}` : "node-feedback:none",
    (current) =>
      selectedJob
        ? current.core.executionRead.listNodeJobFeedback(selectedJob.jobUuid, {
            limit: 100,
          })
        : Promise.resolve(undefined),
  );
  const timeline = useMemo(
    () =>
      toTimelineItems(
        (jobs.data ?? []).map(
          (job) =>
            ({
              ...job,
              kind: "node_job_detail",
              source: job.source,
              workflowTaskUuid: row.task.taskUuid,
              materialUuid: null,
              edgeUuid: null,
              edgeCommandUuid: null,
              feedbackSequence: null,
              topologicalIndex: job.topologicalIndex,
              executionPolicy: {},
              executionTimeoutSeconds: null,
              logicalStatus: job.status,
              param: {},
              feedbackData: {},
              returnInfo: {},
              uncertaintyReason: null,
              dispatchDeadlineAt: null,
              executionDeadlineAt: null,
              cancelCommandUuid: null,
              cancelAckDeadlineAt: null,
              cancelCompleteDeadlineAt: null,
              startedAt: null,
              finishedAt: job.finishedAt ?? null,
            }) as WorkflowNodeJobDetail,
        ),
      ),
    [jobs.data, row.task.taskUuid],
  );
  const nodeNames = useMemo(
    () => taskNodeNames(detail.data?.raw),
    [detail.data?.raw],
  );
  const sendCommand = async (
    type: WorkflowTaskCommandType,
    targetNodeUuid?: string,
  ) => {
    if (row.task.executionKind !== "workflow" || commandBusy) return;
    setCommandBusy(true);
    try {
      await backend.services.workflow.commandWorkflowTask(row.task.taskUuid, {
        type,
        target_node_uuid: targetNodeUuid ?? null,
        idempotency_key: `studio-${row.task.taskUuid}-${type}-${Date.now()}`,
        description: type === "step" ? "任务详情页执行单步" : undefined,
      });
      message.success(
        type === "step" ? "单步命令已发送" : "控制命令已发送",
      );
      runtimeTask.reload();
      detail.reload();
      jobs.reload();
    } catch (error) {
      message.error(error instanceof Error ? error.message : "控制命令发送失败");
    } finally {
      setCommandBusy(false);
    }
  };
  return (
    <div className="page-stack">
      <PageHeader
        title={row.name}
        actions={
          <Space>
            <Button
              onClick={onBack}
              icon={<AppIcon name="arrows/arrow-left" size={16} />}
            >
              返回任务
            </Button>
            {row.task.workflowUuid && (
              <Button
                onClick={() =>
                  onNavigate(
                    "workflows",
                    `?workflow=${encodeURIComponent(row.task.workflowUuid as string)}`,
                  )
                }
              >
                查看当前工作流
              </Button>
            )}
          </Space>
        }
      />
      <AsyncState
        loading={detail.loading || jobs.loading}
        error={detail.error ?? jobs.error}
        onRetry={() => {
          detail.reload();
          jobs.reload();
        }}
        empty={!detail.loading && !jobs.loading && !detail.data}
      >
        <TaskExecutionConsole
          row={row}
          detail={detail.data}
          jobs={jobs.data ?? []}
          timeline={timeline}
          selectedJob={selectedJob}
          onSelectJob={setSelectedJob}
          selectedJobDetail={jobDetail.data}
          feedback={feedback.data?.items ?? []}
          inspectorLoading={jobDetail.loading || feedback.loading}
          controlTask={
            runtimeTask.data ??
            (detail.data
              ? {
                  status: detail.data.status,
                  run_mode: detail.data.runMode,
                  control_status: detail.data.controlStatus,
                }
              : undefined)
          }
          nodeNames={nodeNames}
          commandBusy={commandBusy}
          onCommand={sendCommand}
        />
      </AsyncState>
    </div>
  );
}

function TaskExecutionConsole({
  row,
  detail,
  jobs,
  timeline,
  selectedJob,
  onSelectJob,
  selectedJobDetail,
  feedback,
  inspectorLoading,
  controlTask,
  nodeNames,
  commandBusy,
  onCommand,
}: {
  row: TaskListRow;
  detail?: TaskRuntimeDetail;
  jobs: readonly TaskJobSummary[];
  timeline: ReturnType<typeof toTimelineItems>;
  selectedJob: TaskJobSummary | null;
  onSelectJob: (job: TaskJobSummary) => void;
  selectedJobDetail?: WorkflowNodeJobDetail;
  feedback: readonly NodeJobFeedback[];
  inspectorLoading: boolean;
  controlTask?: {
    status: string;
    run_mode: string;
    control_status: string;
  };
  nodeNames: ReadonlyMap<string, string>;
  commandBusy: boolean;
  onCommand: (type: WorkflowTaskCommandType, targetNodeUuid?: string) => void;
}) {
  const [executionView, setExecutionView] = useState<"timeline" | "gantt">("gantt");
  const inspector = selectedJobDetail ? (
            <NodeInspector
              detail={selectedJobDetail}
              label={jobLabel(selectedJobDetail, 0, nodeNames)}
              feedback={feedback}
              loading={inspectorLoading}
            />
  ) : (
    <Empty description="选择时间线中的节点查看输入、输出和错误" />
  );

  return (
    <section className="detail-card execution-console">
      <div className="execution-console-heading">
        <div>
          <span className="card-kicker">任务执行</span>
          <h2>执行控制台</h2>
          <span>在同一工作区查看节点时序、单步调试、节点详情和资源占用。</span>
        </div>
        <StatusBadge status={row.status} />
      </div>
      <TaskIdentity row={row} detail={detail} />
      <DebugToolbar
        task={controlTask}
        busy={commandBusy}
        onCommand={onCommand}
      />
      <div className="execution-console-grid">
        <div className="execution-console-main">
          <ExecutionTimelineCard
            jobs={jobs}
            items={timeline}
            selectedJob={selectedJob}
            onSelectJob={onSelectJob}
            nodeNames={nodeNames}
            view={executionView}
            onViewChange={setExecutionView}
          />
        </div>
        <aside className="execution-console-side">
          <section className="execution-side-card node-inspector">
            {inspector}
          </section>
          <ResourceCard task={row.task} detail={detail} />
        </aside>
      </div>
    </section>
  );
}

function DebugToolbar({
  task,
  busy,
  onCommand,
}: {
  task?: {
    status: string;
    run_mode: string;
    control_status: string;
  };
  busy: boolean;
  onCommand: (type: WorkflowTaskCommandType, targetNodeUuid?: string) => void;
}) {
  const terminal = ["succeeded", "failed", "canceled", "timeout"].includes(
    task?.status ?? "",
  );
  const mode = task?.run_mode ?? "normal";
  const controlStatus = task?.control_status ?? "active";
  const live = Boolean(task) && !terminal;
  const isPaused = controlStatus === "paused";
  const controlLabel = terminal
    ? "任务已结束"
    : isPaused
      ? "任务已暂停，可执行下一步"
      : "控制命令会由 OS 确认后生效";
  return (
    <div className="debug-toolbar">
      <div className="debug-toolbar-copy">
        <div>
          <span className="card-kicker">调试操作</span>
          <strong>{mode === "step" ? "单步调试" : "正常运行"}</strong>
        </div>
        <span className="muted-cell">{controlLabel}</span>
      </div>
      <Space wrap className="debug-toolbar-actions">
        {mode === "normal" && live && controlStatus === "active" && (
          <Button onClick={() => onCommand("pause")} disabled={busy}>
            暂停任务
          </Button>
        )}
        {mode === "normal" && live && controlStatus === "paused" && (
          <Button type="primary" onClick={() => onCommand("resume")} disabled={busy}>
            继续运行
          </Button>
        )}
        {mode === "step" && isPaused && (
          <>
            <Button
              type="primary"
              onClick={() => onCommand("step")}
              disabled={busy}
              loading={busy}
            >
              执行下一步
            </Button>
            <Button onClick={() => onCommand("resume")} disabled={busy}>
              继续运行
            </Button>
          </>
        )}
        {live && (
          <Button danger onClick={() => onCommand("cancel")} disabled={busy}>
            中止任务
          </Button>
        )}
      </Space>
      <div className="debug-toolbar-meta">
        <Tag color={mode === "step" ? "blue" : "default"}>
          {mode === "step" ? "单步模式" : "正常模式"}
        </Tag>
        <Tag>
          {terminal ? "已结束" : isPaused ? "已暂停" : controlStatus === "active" ? "执行中" : controlStatus}
        </Tag>
      </div>
      {mode === "normal" && live && (
        <Alert
          className="debug-toolbar-hint"
          type="info"
          showIcon
          message="单步模式需要在创建任务时确定；任务会暂停在调度边界，再执行下一步。"
        />
      )}
      {terminal && (
        <Alert
          className="debug-toolbar-hint"
          type="info"
          showIcon
          message="任务已结束，单步调试只对运行中的工作流任务开放。"
        />
      )}
    </div>
  );
}

function TaskIdentity({
  row,
  detail,
}: {
  row: TaskListRow;
  detail?: TaskRuntimeDetail;
}) {
  return (
    <div className="task-identity">
      <Descriptions column={{ xs: 1, sm: 2, lg: 4 }} size="small">
        <Descriptions.Item label="当前状态">
          <StatusBadge status={row.status} />
        </Descriptions.Item>
        <Descriptions.Item label="执行进度">
          {row.progress == null ? "未提供" : `${row.progress}%`}
        </Descriptions.Item>
        <Descriptions.Item label="优先级">
          {row.task.priority ?? "默认"}
        </Descriptions.Item>
        <Descriptions.Item label="运行方式">
          {row.task.runMode}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {displayTime(row.task.createdAt)}
        </Descriptions.Item>
        <Descriptions.Item label="更新时间">
          {displayTime(row.task.updatedAt)}
        </Descriptions.Item>
        <Descriptions.Item label="异常原因" span={2}>
          {row.task.attentionReason ?? "暂无"}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );
}

function NodeInspector({
  detail,
  label,
  feedback,
  loading,
}: {
  detail: WorkflowNodeJobDetail;
  label: string;
  feedback: readonly NodeJobFeedback[];
  loading: boolean;
}) {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  return (
    <>
      <div className="inspector-heading">
        <div>
          <span className="card-kicker">节点详情</span>
          <strong>{label}</strong>
          <small>{detail.executorKind}</small>
        </div>
        <StatusBadge status={jobStatus(detail)} />
      </div>
      <Tabs
        items={[
          {
            key: "input",
            label: "输入",
            children: <pre>{json(detail.param)}</pre>,
          },
          {
            key: "output",
            label: "输出",
            children: (
              <pre>
                {json({
                  feedback: detail.feedbackData,
                  return: detail.returnInfo,
                  events: feedback,
                })}
              </pre>
            ),
          },
          {
            key: "error",
            label: "报错",
            children: detail.errorInfo.length ? (
              <pre className="error-json">{json(detail.errorInfo)}</pre>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="该节点暂无报错信息"
              />
            ),
          },
        ]}
      />
      {loading && <span className="muted-cell">加载节点详情…</span>}
    </>
  );
}

function ExecutionTimelineCard({
  jobs,
  items,
  selectedJob,
  onSelectJob,
  nodeNames,
  view,
  onViewChange,
}: {
  jobs: readonly TaskJobSummary[];
  items: ReturnType<typeof toTimelineItems>;
  selectedJob: TaskJobSummary | null;
  onSelectJob: (job: TaskJobSummary) => void;
  nodeNames: ReadonlyMap<string, string>;
  view: "timeline" | "gantt";
  onViewChange: (view: "timeline" | "gantt") => void;
}) {
  const known = items.filter((item) => item.start != null && item.end != null);
  const start = known.length
    ? Math.min(...known.map((item) => item.start as number))
    : 0;
  const end = known.length
    ? Math.max(...known.map((item) => item.end as number))
    : 1;
  const span = Math.max(1, end - start);
  return (
    <section className="execution-timeline-card">
      <div className="section-title">
        <div>
          <h2>{view === "gantt" ? "节点甘特图" : "节点时间线"}</h2>
          <span>
            {view === "gantt"
              ? "按时间跨度对比节点开始、结束和并行执行情况。"
              : "按节点开始时间排列，沿时间轴查看执行顺序和耗时。"}
          </span>
        </div>
        <Space>
          <Segmented
            size="small"
            value={view}
            onChange={(value) => onViewChange(value as "timeline" | "gantt")}
            options={[
              { label: "时间线", value: "timeline" },
              { label: "甘特图", value: "gantt" },
            ]}
          />
          <Tag color="blue">{jobs.length} 个节点</Tag>
        </Space>
      </div>
      {jobs.length ? (
        view === "gantt" ? (
          <div className="execution-timeline execution-gantt">
            <div className="execution-timeline-head" aria-hidden="true">
              <span>分支 / 节点</span>
              <span className="execution-gantt-axis">
                <span>{formatAxisTime(start)}</span>
                <span>{formatAxisTime(start + span / 2)}</span>
                <span>{formatAxisTime(end)}</span>
              </span>
            </div>
            <div className="execution-timeline-list">
              {jobs.map((job, index) => {
                const item = items.find((candidate) => candidate.id === job.jobUuid);
                if (!item) return null;
                const selected = selectedJob?.jobUuid === job.jobUuid;
                return (
                  <button
                    type="button"
                    className={`execution-timeline-row ${selected ? "is-selected" : ""}`}
                    key={job.jobUuid}
                    onClick={() => onSelectJob(job)}
                  >
                    <span className="execution-node-cell">
                      <span className="topology-node-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="execution-node-copy">
                        <strong>{jobLabel(job, index, nodeNames)}</strong>
                        <small>{job.executorKind}</small>
                      </span>
                      <StatusBadge status={jobStatus(job)} />
                    </span>
                    <span className="gantt-track">
                      {item.start != null && item.end != null ? (
                        <span
                          className={`gantt-bar gantt-bar--${item.status}`}
                          style={{
                            left: `${((item.start - start) / span) * 100}%`,
                            width: `${Math.max(4, ((item.end - item.start) / span) * 100)}%`,
                          }}
                        >
                          <span className="execution-bar-label">{item.duration}</span>
                        </span>
                      ) : (
                        <span className="gantt-missing">时间未提供</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="execution-timeline execution-event-list">
            <div className="execution-event-head" aria-hidden="true">
              <span>时间</span>
              <span />
              <span>节点 / 耗时</span>
              <span>状态</span>
            </div>
            {jobs.map((job, index) => {
              const item = items.find((candidate) => candidate.id === job.jobUuid);
              if (!item) return null;
              const selected = selectedJob?.jobUuid === job.jobUuid;
              return (
                <button
                  type="button"
                  className={`execution-event-row ${selected ? "is-selected" : ""}`}
                  key={job.jobUuid}
                  onClick={() => onSelectJob(job)}
                >
                  <span className="execution-event-time">
                    {item.start != null ? formatAxisTime(item.start) : "—"}
                  </span>
                  <span className={`execution-timeline-dot execution-timeline-dot--${item.status}`} />
                  <span className="execution-node-copy">
                    <strong>{jobLabel(job, index, nodeNames)}</strong>
                    <small>{job.executorKind} · {item.duration}</small>
                  </span>
                  <StatusBadge status={jobStatus(job)} />
                </button>
              );
            })}
          </div>
        )
      ) : (
        <Empty description="暂无节点执行记录" />
      )}
    </section>
  );
}

function formatAxisTime(timestamp: number): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function ResourceCard({
  task,
  detail,
}: {
  task: TaskRuntimePresentation;
  detail?: TaskRuntimeDetail;
}) {
  const entries = resourceEntries(
    detail?.raw?.resources ??
      detail?.raw?.resource_occupancy ??
      task.raw?.resources,
  );
  return (
    <section className="execution-side-card resource-card">
      <div className="section-title">
        <div>
          <h2>资源占用</h2>
          <span>资源信息只展示后端回传内容。</span>
        </div>
      </div>
      {entries.length ? (
        <div className="resource-grid">
          {entries.map(([key, value]) => (
            <div className="resource-item" key={key}>
              <AppIcon name="shapes/cube-03" size={18} color="context" />
              <div>
                <strong>{key}</strong>
                <span>{value}</span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="任务尚未返回资源占用明细"
        />
      )}
    </section>
  );
}
