import { cx } from "../../styles/styleMaps";
import {
  Button,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tooltip,
  message,
} from "antd";
import type { TableColumnsType } from "antd";
import { EmptyState } from "@unilab/design-v2";
import { useEffect, useMemo, useState } from "react";
import type { TaskRuntimePresentation } from "@unilab-fe/core";
import { useBackend } from "../../app/BackendProvider";
import { AppIcon } from "../../components/ui/Icon";
import { AsyncState } from "../../components/ui/AsyncState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TableText } from "../../components/ui/TableText";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import { displayTime, toTaskListRow, type TaskListRow } from "./taskDomain";
import { TaskDetailPage } from "./TaskDetailPage";

export function TasksPage() {
  const query = useBackendQuery("task-presentations", (backend) =>
    backend.core.executionRead.listTaskPresentations({
      page: 1,
      pageSize: 200,
      terminalLimit: 200,
    }),
  );
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("task"),
  );
  const rows = useMemo(
    () =>
      (query.data?.items ?? []).map(toTaskListRow).filter((row) => {
        const text =
          `${row.name} ${row.workflowName} ${row.task.taskUuid}`.toLowerCase();
        return (
          (!keyword.trim() || text.includes(keyword.trim().toLowerCase())) &&
          (status === "all" || row.status === status)
        );
      }),
    [keyword, query.data, status],
  );
  useEffect(() => {
    const syncSelectedTask = () => {
      setSelectedUuid(new URLSearchParams(window.location.search).get("task"));
    };
    window.addEventListener("popstate", syncSelectedTask);
    return () => window.removeEventListener("popstate", syncSelectedTask);
  }, []);

  const openTask = (row: TaskListRow) => {
    window.history.pushState(
      {},
      "",
      `/tasks?task=${encodeURIComponent(row.task.taskUuid)}`,
    );
    setSelectedUuid(row.task.taskUuid);
  };

  const closeTask = () => {
    window.history.pushState({}, "", "/tasks");
    setSelectedUuid(null);
  };

  // URL 中已有任务编号时直接保持详情路由。刷新期间列表请求尚未完成，
  // 不能因为 rows 暂时为空而先回退到列表，再跳回详情。
  if (selectedUuid)
    return (
      <TaskDetailPage taskUuid={selectedUuid} onBack={closeTask} />
    );
  const columns: TableColumnsType<TaskListRow> = [
    {
      title: "任务",
      key: "name",
      width: 300,
      render: (_, row) => (
        <div className={cx("primary-cell")}>
          <Button
            type="link"
            className={cx("task-name-link")}
            onClick={() => openTask(row)}
            aria-label={`查看任务 ${row.name}`}
          >
            <TableText text={row.name} />
          </Button>
        </div>
      ),
    },
    { title: "工作流", key: "workflowName", width: 220, render: (_, row) => <TableText text={row.workflowName} /> },
    {
      title: "状态",
      dataIndex: "status",
      width: 125,
      render: (value) => <StatusBadge status={value} />,
    },
    {
      title: "进度",
      key: "progress",
      width: 150,
      render: (_, row) => (
        <div className={cx("progress-cell")}>
          <span>{row.progress == null ? "—" : `${row.progress}%`}</span>
          <span className={cx("muted-cell")}>
            {row.completedJobs}/{row.totalJobs} 节点
          </span>
        </div>
      ),
    },
    {
      title: "时间",
      key: "time",
      width: 190,
      render: (_, row) => (
        <span className={cx("muted-cell")}>{displayTime(row.task.createdAt)}</span>
      ),
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      align: "center",
      render: (_, row) => (
        <Space size={2}>
          <Tooltip title="查看">
            <Button
              type="text"
              className={cx("icon-button")}
              aria-label={`查看任务 ${row.name}`}
              icon={<AppIcon name="general/eye" size={18} />}
              onClick={() => openTask(row)}
            />
          </Tooltip>
          <AbortTaskButton
            taskUuid={row.task.taskUuid}
            status={row.status}
            onDone={query.reload}
          />
        </Space>
      ),
    },
  ];
  return (
    <div className={cx("page-stack")}>
      <PageHeader title="任务" />
      <section className={cx("data-section")}>
        <div className={cx("data-section-toolbar")}>
          <div className={cx("section-title")}>
            <h2>任务列表</h2>
          </div>
          <Space>
            <Input
              allowClear
              className={cx("search-input")}
              prefix={<AppIcon name="general/search-md" size={16} />}
              placeholder="搜索名称、工作流或任务编号"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
            <Select
              className={cx("status-select")}
              value={status}
              onChange={setStatus}
              options={[
                { value: "all", label: "全部状态" },
                { value: "waiting", label: "等待中" },
                { value: "running", label: "执行中" },
                { value: "attention", label: "异常" },
                { value: "completed", label: "已完成" },
                { value: "failed", label: "失败" },
              ]}
            />
            <Tooltip title="刷新">
              <Button
                type="text"
                loading={query.loading}
                aria-label="刷新任务列表"
                icon={<AppIcon name="arrows/refresh-ccw-01" size={18} />}
                onClick={query.reload}
              />
            </Tooltip>
          </Space>
        </div>
        <AsyncState
          loading={query.loading}
          error={query.error}
          onRetry={query.reload}
          empty={!query.loading && rows.length === 0}
          emptyDescription="当前后端没有任务记录"
          variant="table"
          tableColumns={6}
        >
          <Table
            rowKey={(row) => row.task.taskUuid}
            columns={columns}
            dataSource={rows}
            locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无任务" /> }}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
          />
        </AsyncState>
      </section>
    </div>
  );
}

function AbortTaskButton({
  taskUuid,
  status,
  onDone,
}: {
  taskUuid: string;
  status: string;
  onDone: () => void;
}) {
  const { backend } = useBackend();
  const [busy, setBusy] = useState(false);
  const available = ["running", "waiting", "attention"].includes(status);
  const abort = () =>
    Modal.confirm({
      title: "中止任务？",
      content: "将向后端发送 cancel 命令，最终状态以运行时回传为准。",
      okText: "中止",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBusy(true);
        try {
          const receipt = await backend.core.executionControl.sendTaskCommand(taskUuid, {
            type: "cancel",
            idempotencyKey: `studio-${taskUuid}-cancel-${Date.now()}`,
          });
          message.success(receipt.accepted ? "中止命令已接受，等待 OS 生效" : "中止命令未被接受");
          onDone();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "中止失败");
        } finally {
          setBusy(false);
        }
      },
    });
  return (
    <Tooltip title={available ? "中止" : "当前任务不可中止"}>
      <Button
        type="text"
        danger
        disabled={!available}
        loading={busy}
        className={cx("icon-button")}
        aria-label="中止任务"
        icon={<AppIcon name="media/stop-circle" size={18} />}
        onClick={abort}
      />
    </Tooltip>
  );
}
