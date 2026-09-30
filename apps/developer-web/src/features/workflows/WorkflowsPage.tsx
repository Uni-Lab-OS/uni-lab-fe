import { cx } from "../../styles/styleMaps";
import {
  Alert,
  Button,
  Descriptions,
  Empty,
  Input,
  Modal,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  message,
} from "antd";
import type { TableColumnsType } from "antd";
import { EmptyState } from "@unilab/design-v2";
import { useEffect, useMemo, useState } from "react";
import type {
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary,
} from "@unilab-fe/core";
import { useBackend } from "../../app/BackendProvider";
import type { StudioRoute } from "../../components/AppShell";
import { AppIcon } from "../../components/ui/Icon";
import { AsyncState } from "../../components/ui/AsyncState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import { TableText } from "../../components/ui/TableText";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import {
  jsonText,
  nodeUuid,
  readString,
  resolveWorkflowResourceName,
  workflowValueText,
  workflowCounts,
  workflowContracts,
  workflowNodeDetails,
  workflowStatusLabel,
  type WorkflowResourceDirectory,
  type WorkflowRecord,
} from "./workflowPresentation";
import { WorkflowDebugPage } from "./WorkflowDebugPage";
import { WorkflowFlowCanvas } from "./WorkflowFlowCanvas";

export function WorkflowsPage({
  onNavigate,
}: {
  onNavigate: (route: StudioRoute, search?: string) => void;
}) {
  const { backend } = useBackend();
  const query = useBackendQuery("workflow-catalog", (current) =>
    current.core.workflowDefinitions.listPublishedRevisions({
      page: 1,
      pageSize: 100,
      allPages: true,
      status: "all",
    }),
  );
  const [kind, setKind] = useState<"workflow" | "experiment_operation">(
    "workflow",
  );
  const [keyword, setKeyword] = useState("");
  const [selected, setSelected] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("workflow"),
  );
  const [debugUuid, setDebugUuid] = useState<string | null>(() =>
    new URLSearchParams(window.location.search).get("debugWorkflow"),
  );

  // SZLab 当前发布的标准物料转运属于“实验操作”类型。首屏不能固定
  // 假设一定存在 workflow，否则真实后端有数据时仍会显示空状态。
  useEffect(() => {
    if (!query.data?.length) return;
    if (query.data.some((item) => item.workflowType === kind)) return;
    const firstAvailableKind = query.data[0]?.workflowType;
    if (firstAvailableKind) setKind(firstAvailableKind);
  }, [kind, query.data]);

  useEffect(() => {
    if (!debugUuid || !window.location.search.includes("debugWorkflow")) return;
    window.history.replaceState({}, "", "/workflows");
  }, [debugUuid]);

  useEffect(() => {
    const syncSelectedWorkflow = () => {
      setSelected(new URLSearchParams(window.location.search).get("workflow"));
    };
    window.addEventListener("popstate", syncSelectedWorkflow);
    return () => window.removeEventListener("popstate", syncSelectedWorkflow);
  }, []);

  const rows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return (query.data ?? []).filter((item) => {
      const matchesKind = item.workflowType === kind;
      const matchesKeyword =
        !normalized ||
        `${item.name} ${item.workflowUuid}`.toLowerCase().includes(normalized);
      return matchesKind && matchesKeyword;
    });
  }, [kind, keyword, query.data]);

  if (debugUuid) {
    return (
      <WorkflowDebugPage
        workflowUuid={debugUuid}
        onBack={() => setDebugUuid(null)}
        onNavigate={onNavigate}
      />
    );
  }
  if (selected) {
    return (
      <WorkflowDetail
        workflowUuid={selected}
        onBack={() => {
          window.history.replaceState({}, "", "/workflows");
          setSelected(null);
        }}
        onDebug={setDebugUuid}
      />
    );
  }

  const openWorkflow = (workflowUuid: string) => {
    window.history.pushState(
      {},
      "",
      `/workflows?workflow=${encodeURIComponent(workflowUuid)}`,
    );
    setSelected(workflowUuid);
  };

  const columns: TableColumnsType<PublishedWorkflowRevisionSummary> = [
    {
      title: "名称",
      key: "name",
      render: (_, row) => (
        <div className={cx("primary-cell")}>
          <button
            type="button"
            className={cx("workflow-name-link")}
            onClick={() => openWorkflow(row.workflowUuid)}
          >
            <TableText text={row.name} />
          </button>
          <div className={cx("workflow-uuid-cell")}>
            <TableText className={cx("table-secondary-text")} text={row.workflowUuid} />
            <CopyWorkflowUuidButton workflow={row} />
          </div>
        </div>
      ),
    },
    {
      title: "版本",
      dataIndex: "revision",
      align: "center",
      width: 90,
      render: (value) => `v${value}`,
    },
    {
      title: "状态",
      dataIndex: "status",
      align: "center",
      width: 110,
      render: (value) => (
        value === "published" ? (
          <Tag color="green">已发布</Tag>
        ) : value === "source" ? (
          <Tag className={cx("status-badge")} color="default">
            未发布
          </Tag>
        ) : (
          <StatusBadge status={value} label={workflowStatusLabel(value)} />
        )
      ),
    },
    {
      title: "操作",
      key: "actions",
      align: "center",
      width: 170,
      render: (_, row) => (
        <Space size={2}>
          <Tooltip title="查看">
            <Button
              type="text"
              className={cx("icon-button")}
              aria-label={`查看工作流 ${row.name}`}
              icon={<AppIcon name="general/eye" size={18} />}
              onClick={() => openWorkflow(row.workflowUuid)}
            />
          </Tooltip>
          <Tooltip title="调试">
            <Button
              type="text"
              className={cx("icon-button")}
              aria-label={`调试工作流 ${row.name}`}
              icon={<AppIcon name="media/play-circle" size={18} />}
              onClick={() => setDebugUuid(row.workflowUuid)}
            />
          </Tooltip>
          <DeleteWorkflowButton workflow={row} onDeleted={query.reload} />
        </Space>
      ),
    },
  ];

  return (
    <div className={cx("page-stack workflow-list-page")}>
      <PageHeader
        title="工作流"
      />
      <section className={cx("data-section workflow-data-section")}>
        <div className={cx("data-section-toolbar workflow-toolbar")}>
          <Tabs
            className={cx("workflow-tabs")}
            activeKey={kind}
            onChange={(value) => setKind(value as typeof kind)}
            items={[
              {
                key: "experiment_operation",
                label: `实验操作 ${
                  query.data?.filter(
                    (item) => item.workflowType === "experiment_operation",
                  ).length ?? 0
                }`,
              },
              {
                key: "workflow",
                label: `工作流 ${
                  query.data?.filter((item) => item.workflowType === "workflow")
                    .length ?? 0
                }`,
              },
            ]}
          />
          <Space>
            <Input
              allowClear
              className={cx("search-input")}
              prefix={<AppIcon name="general/search-md" size={16} />}
              placeholder="搜索名称或 UUID"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </Space>
        </div>
        <AsyncState
          loading={query.loading}
          error={query.error}
        onRetry={query.reload}
        empty={!query.loading && rows.length === 0}
        emptyDescription="当前后端没有工作流"
        variant="table"
        tableColumns={4}
      >
          <Table
            className={cx("workflow-table")}
            rowKey="workflowUuid"
            columns={columns}
            dataSource={[...rows]}
            locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无工作流" /> }}
            pagination={{
              pageSize: 10,
              showSizeChanger: false,
              showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 条`,
            }}
          />
        </AsyncState>
      </section>
    </div>
  );
}

function CopyWorkflowUuidButton({
  workflow,
}: {
  workflow: PublishedWorkflowRevisionSummary;
}) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(workflow.workflowUuid);
      message.success("UUID 已复制");
    } catch {
      message.error("复制失败，请检查浏览器剪贴板权限");
    }
  };

  return (
    <Tooltip title="复制 UUID">
      <Button
        type="text"
        className={cx("workflow-uuid-copy icon-button")}
        aria-label={`复制工作流 ${workflow.name} 的 UUID`}
        icon={<AppIcon name="general/copy-01" size={14} />}
        onClick={copy}
      />
    </Tooltip>
  );
}

function DeleteWorkflowButton({
  workflow,
  onDeleted,
}: {
  workflow: PublishedWorkflowRevisionSummary;
  onDeleted: () => void;
}) {
  const { backend } = useBackend();
  const [busy, setBusy] = useState(false);
  const available = backend.getCapabilityStatus(
    "workflow.editDefinitions",
  ).available;
  const remove = () =>
    Modal.confirm({
      title: `删除“${workflow.name}”？`,
      content: "该操作会调用后端删除工作流定义，请确认后端已允许此操作。",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        setBusy(true);
        try {
          await backend.core.workflowDefinitions.deleteWorkflowDefinition(
            workflow.workflowUuid,
          );
          message.success("工作流已删除");
          onDeleted();
        } catch (error) {
          message.error(error instanceof Error ? error.message : "删除失败");
        } finally {
          setBusy(false);
        }
      },
    });
  return (
    <Tooltip title={available ? "删除" : "当前后端不支持删除"}>
      <Button
        type="text"
        danger
        disabled={!available}
        loading={busy}
        className={cx("icon-button")}
        aria-label={`删除工作流 ${workflow.name}`}
        icon={<AppIcon name="general/trash-01" size={18} />}
        onClick={remove}
      />
    </Tooltip>
  );
}

function WorkflowDetail({
  workflowUuid,
  onBack,
  onDebug,
}: {
  workflowUuid: string;
  onBack: () => void;
  onDebug: (uuid: string) => void;
}) {
  const query = useBackendQuery(`workflow-detail:${workflowUuid}`, (current) =>
    current.core.workflowDefinitions.getPublishedRevision(workflowUuid),
  );
  const resourceDirectoryQuery = useBackendQuery<WorkflowResourceDirectory>(
    "workflow-resource-directory",
    async (current) => {
      const [graph, devices] = await Promise.all([
        current.core.materialSite.getGraph(),
        current.core.deviceActions.listDevices(),
      ]);
      const resourceTemplates = new Map<string, string>();
      const materials = graph.nodes.map((node) => {
        if (node.resourceTemplate) {
          resourceTemplates.set(
            node.resourceTemplate.uuid,
            node.resourceTemplate.displayName,
          );
        }
        return {
          uuid: node.material.materialUuid,
          name: node.material.name,
        };
      });
      const sites = graph.nodes.flatMap((node) =>
        node.sites.map((site) => ({ uuid: site.siteUuid, name: site.name })),
      );
      return {
        resourceTemplates: [...resourceTemplates].map(([uuid, displayName]) => ({ uuid, displayName })),
        materials,
        sites,
        devices: devices.map((device) => ({
          deviceUuid: device.deviceUuid,
          deviceKey: device.deviceKey,
          label: device.label,
        })),
      };
    },
  );
  const [nodeId, setNodeId] = useState<string | null>(null);
  const resourceDirectory = resourceDirectoryQuery.data ?? {
    resourceTemplates: [],
    materials: [],
    sites: [],
    devices: [],
  } satisfies WorkflowResourceDirectory;
  return (
    <div className={cx("page-stack workflow-detail-page")}>
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        empty={!query.loading && !query.data}
      >
        {query.data && (
          <>
            <div className={cx("workflow-detail-heading")}>
              <div className={cx("workflow-detail-title")}>
                <Tooltip title="返回工作流">
                  <Button
                    type="text"
                    className={cx("page-header-back workflow-back-icon")}
                    aria-label="返回工作流"
                    onClick={onBack}
                    icon={<AppIcon name="arrows/arrow-left" size={18} />}
                  />
                </Tooltip>
                <div className={cx("workflow-detail-title-copy")}>
                  <Tooltip title={query.data.name} mouseEnterDelay={0.2}>
                    <h1>{query.data.name}</h1>
                  </Tooltip>
                </div>
              </div>
              <div className={cx("workflow-detail-heading-actions")}>
                <Tag color={query.data.status === "published" ? "green" : "blue"}>
                  {workflowStatusLabel(query.data.status)}
                </Tag>
                <Button
                  type="default"
                  onClick={() => message.info("发布功能暂未接入")}
                >
                  发布
                </Button>
                <Button
                  type="primary"
                  onClick={() => onDebug(workflowUuid)}
                  icon={<AppIcon name="media/play-circle" size={16} color="white" />}
                >
                  调试工作流
                </Button>
              </div>
            </div>
            <WorkflowTopology
              revision={query.data}
              selectedNode={nodeId}
              onSelect={setNodeId}
              resourceDirectory={resourceDirectory}
            />
          </>
        )}
      </AsyncState>
    </div>
  );
}

function WorkflowTopology({
  revision,
  selectedNode,
  onSelect,
  resourceDirectory,
}: {
  revision: PublishedWorkflowRevision;
  selectedNode: string | null;
  onSelect: (id: string | null) => void;
  resourceDirectory: WorkflowResourceDirectory;
}) {
  const counts = workflowCounts(revision);
  const activeNodeId = selectedNode;
  const activeNode = revision.graph.nodes.find(
    (item, index) => nodeUuid(item, index) === activeNodeId,
  );
  return (
    <div className={cx("workflow-topology-layout")}>
        <section className={cx("detail-card topology-card")}>
          <div className={cx("workflow-panel-heading")}>
            <h2>拓扑结构</h2>
            <Tag>{counts.nodes} 个节点</Tag>
          </div>
          <div className={cx("topology-canvas")}>
            {revision.graph.nodes.length === 0 ? (
              <Empty description="后端没有返回节点" />
            ) : (
              <WorkflowFlowCanvas
                graph={revision.graph}
                selectedNode={activeNodeId}
                onSelect={onSelect}
              />
            )}
          </div>
        </section>
        <section className={cx("detail-card node-inspector")}>
          <div className={cx("workflow-panel-heading node-inspector-heading")}>
            <h2>{activeNode ? "节点信息" : "工作流信息"}</h2>
          </div>
          {activeNode ? (
            <NodeInspector
              revision={revision}
              node={activeNode}
              resourceDirectory={resourceDirectory}
            />
          ) : (
            <WorkflowInfoPanel revision={revision} counts={counts} />
          )}
        </section>
    </div>
  );
}

function WorkflowInfoPanel({
  revision,
  counts,
}: {
  revision: PublishedWorkflowRevision;
  counts: ReturnType<typeof workflowCounts>;
}) {
  return (
    <div className={cx("workflow-info-panel")}>
      <div className={cx("workflow-info-form")}>
        <div>
          <span>uuid</span>
          <code>{revision.workflowUuid}</code>
        </div>
        <div>
          <span>当前版本</span>
          <strong>Revision {revision.revision}</strong>
        </div>
        <div>
          <span>节点数量</span>
          <strong>{counts.nodes} 个节点</strong>
        </div>
        <div>
          <span>连线数量</span>
          <strong>{counts.edges} 条连线</strong>
        </div>
      </div>
      <WorkflowContractSummary revision={revision} />
    </div>
  );
}

function WorkflowContractSummary({ revision }: { revision: PublishedWorkflowRevision }) {
  const contracts = workflowContracts(revision);
  return (
    <div className={cx("workflow-contract-summary")}>
      <ContractGroup title="工作流输入" fields={contracts.inputs} empty="未声明输入参数" />
      <ContractGroup title="工作流输出" fields={contracts.outputs} empty="未声明输出参数" />
    </div>
  );
}

function ContractGroup({
  title,
  fields,
  empty,
}: {
  title: string;
  fields: ReturnType<typeof workflowContracts>["inputs"];
  empty: string;
}) {
  return (
    <div className={cx("workflow-contract-group")}>
      <strong>{title}</strong>
      {fields.length ? (
        <div className={cx("workflow-contract-list")}>
          {fields.map((field) => (
            <span key={field.name} className={cx("workflow-contract-chip")}>
              {field.name}
              {field.required ? <em>必填</em> : null}
            </span>
          ))}
        </div>
      ) : (
        <span className={cx("workflow-contract-empty")}>{empty}</span>
      )}
    </div>
  );
}

function NodeInspector({
  revision,
  node,
  resourceDirectory,
}: {
  revision: PublishedWorkflowRevision;
  node: Readonly<Record<string, unknown>>;
  resourceDirectory: WorkflowResourceDirectory;
}) {
  const details = workflowNodeDetails(revision, node);
  return (
    <Tabs
      items={[
        {
          key: "base",
          label: "基础信息",
          children: (
            <Descriptions className={cx("workflow-node-descriptions")} column={1} size="small">
              <Descriptions.Item label="节点 UUID">
                {readString(node, ["uuid", "node_uuid"]) ?? "暂无"}
              </Descriptions.Item>
              <Descriptions.Item label="节点类型">
                {readString(node, ["type", "node_type"]) ?? "暂无"}
              </Descriptions.Item>
              <Descriptions.Item label="动作名称">
                {readString(node, ["action_name", "name"]) ?? "暂无"}
              </Descriptions.Item>
              <Descriptions.Item label="动作类型">
                {readString(node, ["action_type", "executor_kind"]) ?? "暂无"}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                {node.disabled === true ? "已禁用" : "可执行"}
              </Descriptions.Item>
              <Descriptions.Item label="描述">
                {readString(node, ["description"]) ?? "暂无描述"}
              </Descriptions.Item>
            </Descriptions>
          ),
        },
        {
          key: "io",
          label: `输入输出 (${details.inputs.length}/${details.outputs.length})`,
          children: (
            <div className={cx("workflow-node-io")}>
              <NodeHandleGroup
                title="输入参数"
                handles={details.inputs}
                empty="该节点没有输入句柄"
                resourceDirectory={resourceDirectory}
              />
              <NodeHandleGroup
                title="输出结果"
                handles={details.outputs}
                empty="该节点没有输出句柄"
                resourceDirectory={resourceDirectory}
              />
            </div>
          ),
        },
        {
          key: "resources",
          label: `资源需求 (${details.resources.length})`,
          children: details.resources.length ? (
            <div className={cx("workflow-resource-list")}>
              {details.resources.map((resource, index) => (
                <div className={cx("workflow-resource-row")} key={`${resource.kind}-${resource.value}-${index}`}>
                  <strong>{resource.kindLabel}</strong>
                  <span>{resolveWorkflowResourceName(resource.kind, resource.value, resourceDirectory)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该节点没有声明资源需求" />
          ),
        },
      ]}
    />
  );
}

function NodeHandleGroup({
  title,
  handles,
  empty,
  resourceDirectory,
}: {
  title: string;
  handles: ReturnType<typeof workflowNodeDetails>["inputs"];
  empty: string;
  resourceDirectory: WorkflowResourceDirectory;
}) {
  return (
    <section className={cx("workflow-handle-group")}>
      <div className={cx("workflow-handle-group__title")}>
        <strong>{title}</strong>
        <span>{handles.length}</span>
      </div>
      {handles.length ? (
        <div className={cx("workflow-handle-grid")}>
          {handles.map((handle) => (
            <div className={cx("workflow-handle-card")} key={handle.name}>
              <div>
                <strong>{handle.name}</strong>
                {handle.required ? <em>必填</em> : <small>可选</small>}
              </div>
              <span>{handle.schema?.type ? String(handle.schema.type) : "未声明类型"}</span>
              {handle.value !== undefined ? <code>{workflowValueText(handle.value, resourceDirectory)}</code> : null}
              {handle.description ? <small>{handle.description}</small> : null}
            </div>
          ))}
        </div>
      ) : (
        <span className={cx("workflow-contract-empty")}>{empty}</span>
      )}
    </section>
  );
}
