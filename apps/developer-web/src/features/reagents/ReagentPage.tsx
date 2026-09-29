import { Button, Input, Space, Table, Tabs, Tag, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { useMemo, useState } from "react";
import type { Reagent, ReagentInfo } from "@unilab-fe/core";
import { EmptyState } from "@unilab/design-v2";
import { useBackend } from "../../app/BackendProvider";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import { AppIcon } from "../../components/ui/Icon";
import { AsyncState } from "../../components/ui/AsyncState";
import { PageHeader } from "../../components/ui/PageHeader";
import { ReagentModal, type ReagentModalState } from "./ReagentModal";
import { TableText } from "../../components/ui/TableText";

interface ReagentData {
  readonly inventory: readonly Reagent[];
  readonly catalog: readonly ReagentInfo[];
}

export function ReagentsPage() {
  const { backend } = useBackend();
  const query = useBackendQuery<ReagentData>(
    "reagent-resources",
    async (current) => {
      const [inventory, catalog] = await Promise.all([
        current.core.reagentInventory.listReagents({ page: 1, pageSize: 200 }),
        current.core.reagentInventory.listReagentInfos({
          page: 1,
          pageSize: 200,
        }),
      ]);
      return { inventory: inventory.items, catalog: catalog.items };
    },
  );
  const [tab, setTab] = useState<"inventory" | "catalog">("inventory");
  const [keyword, setKeyword] = useState("");
  const [modal, setModal] = useState<ReagentModalState | null>(null);
  const inventory = useMemo(
    () =>
      (query.data?.inventory ?? []).filter((item) =>
        `${item.name} ${item.containerName ?? ""} ${item.containerBarcode ?? ""}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  const catalog = useMemo(
    () =>
      (query.data?.catalog ?? []).filter((item) =>
        `${item.name} ${item.nameEn ?? ""} ${item.cas ?? ""}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  const canCreateInfo = backend.services.getCapabilityStatus("reagentInfo.create").available;
  const canCreateInventory = backend.services.getCapabilityStatus("inventory.createReagent").available;
  const canUpdateInventory = backend.services.getCapabilityStatus("inventory.updateReagent").available;
  const canReadHistory = backend.services.getCapabilityStatus("inventory.readReagentHistory").available;

  return (
    <div className="page-stack">
      <PageHeader
        title="试剂"
        actions={
          <Space>
            <Tooltip
              title={
                canCreateInfo
                  ? undefined
                  : "当前端点未开放试剂目录写入能力。"
              }
            >
              <span>
                <Button
                  disabled={!canCreateInfo}
                  icon={<AppIcon name="general/plus" color="primary" size={16} />}
                  onClick={() => setModal({ type: "create-info" })}
                >
                  新增试剂
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              title={
                canCreateInventory
                  ? undefined
                  : "当前端点未开放库存写入能力。"
              }
            >
              <span>
                <Button
                  type="primary"
                  disabled={!canCreateInventory}
                  icon={
                    <AppIcon
                      name="development/package-plus"
                      color="white"
                      size={16}
                    />
                  }
                  onClick={() => setModal({ type: "create-inventory" })}
                >
                  录入库存
                </Button>
              </span>
            </Tooltip>
          </Space>
        }
      />
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        variant="table"
        tableColumns={5}
      >
        <section className="data-section">
          <div className="data-section-toolbar">
            <Tabs
              className="reagent-tabs"
              activeKey={tab}
              onChange={(key) => {
                setTab(key as "inventory" | "catalog");
                setKeyword("");
              }}
              items={[
                {
                  key: "inventory",
                  label: `库存 ${query.data?.inventory.length ?? 0}`,
                },
                {
                  key: "catalog",
                  label: `目录 ${query.data?.catalog.length ?? 0}`,
                },
              ]}
            />
            <Input
              className="search-input"
              allowClear
              prefix={<AppIcon name="general/search-md" size={16} />}
              placeholder={
                tab === "inventory"
                  ? "搜索库存、容器或 CAS"
                  : "搜索名称或 CAS 号"
              }
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </div>
          {tab === "inventory" ? (
            <InventoryTable
              data={inventory}
              canMutate={canUpdateInventory}
              onHistory={(item) => setModal({ type: "history", reagent: item })}
              canReadHistory={canReadHistory}
              onEdit={(item) =>
                setModal({ type: "edit-inventory", reagent: item })
              }
            />
          ) : (
            <CatalogTable
              data={catalog}
              canMutate={canCreateInventory}
              onDetail={(item) =>
                setModal({ type: "catalog-detail", info: item })
              }
              onCreateInventory={(item) =>
                setModal({ type: "create-inventory", info: item })
              }
            />
          )}
        </section>
      </AsyncState>
      <ReagentModal
        state={modal}
        onClose={() => setModal(null)}
        onSaved={query.reload}
      />
    </div>
  );
}

function InventoryTable({
  data,
  canMutate,
  onHistory,
  canReadHistory,
  onEdit,
}: {
  data: readonly Reagent[];
  canMutate: boolean;
  onHistory: (item: Reagent) => void;
  canReadHistory: boolean;
  onEdit: (item: Reagent) => void;
}) {
  const columns: TableColumnsType<Reagent> = [
    {
      title: "库存名称",
      key: "name",
      width: 310,
      render: (_, item) => (
        <div className="primary-cell">
          <TableText text={item.name} />
          <span>
            {item.containerName ?? "容器未提供"}
            {item.containerBarcode ? ` / ${item.containerBarcode}` : ""}
          </span>
        </div>
      ),
    },
    {
      title: "余量",
      key: "quantity",
      width: 145,
      render: (_, item) => (
        <div className="amount-cell">
          <strong>
            {item.quantity == null
              ? "未提供"
              : `${item.quantity} ${item.quantityUnit ?? ""}`}
          </strong>
          {item.status && (
            <Tag
              color={
                item.status === "available"
                  ? "success"
                  : item.status === "empty"
                    ? "default"
                    : "warning"
              }
            >
              {item.status}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: "物性",
      key: "property",
      width: 175,
      render: (_, item) => (
        <span className="muted-cell">
          {item.physicalState ?? "未提供"}
          {item.concentrationValue != null
            ? ` / ${item.concentrationValue}${item.concentrationUnit ?? ""}`
            : ""}
        </span>
      ),
    },
    {
      title: "容器物料",
      dataIndex: "materialUuid",
      width: 230,
      render: (value: string) => <span className="muted-cell">{value}</span>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      width: 165,
      render: (value: string | null) => (
        <span className="muted-cell">{value ?? "未提供"}</span>
      ),
    },
    {
      title: "操作",
      key: "operation",
      align: "right",
      width: 100,
      render: (_, item) => (
        <Space size={2}>
          <Tooltip title={canReadHistory ? "查看历史" : "当前端点不支持库存历史"}>
            <Button
              className="icon-button"
              type="text"
              icon={<AppIcon name="time/clock-refresh" size={18} />}
              onClick={() => onHistory(item)}
              disabled={!canReadHistory}
            />
          </Tooltip>
          <Tooltip title={canMutate ? "编辑库存" : "当前端点不支持此项写入"}>
            <Button
              className="icon-button"
              type="text"
              disabled={!canMutate}
              icon={
                <AppIcon
                  name="general/edit-05"
                  color={canMutate ? "primary" : "context"}
                  size={18}
                />
              }
              onClick={() => onEdit(item)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];
  return (
    <Table<Reagent>
      rowKey="reagentUuid"
      columns={columns}
      dataSource={[...data]}
      locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无库存" /> }}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
    />
  );
}

function CatalogTable({
  data,
  canMutate,
  onDetail,
  onCreateInventory,
}: {
  data: readonly ReagentInfo[];
  canMutate: boolean;
  onDetail: (item: ReagentInfo) => void;
  onCreateInventory: (item: ReagentInfo) => void;
}) {
  const columns: TableColumnsType<ReagentInfo> = [
    {
      title: "试剂名称",
      key: "name",
      width: 330,
      render: (_, item) => (
        <div className="primary-cell">
          <TableText text={item.name} />
          <span>
            {item.nameEn ?? "未提供英文名"}
            {item.molecularFormula ? ` / ${item.molecularFormula}` : ""}
          </span>
        </div>
      ),
    },
    {
      title: "CAS 号",
      dataIndex: "cas",
      width: 175,
      render: (value: string | null) => value ?? "未提供",
    },
    {
      title: "物态",
      dataIndex: "physicalState",
      width: 120,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: "分子量",
      dataIndex: "molecularWeight",
      width: 130,
      render: (value: number | null) =>
        value == null ? "未提供" : `${value} g/mol`,
    },
    {
      title: "操作",
      key: "operation",
      align: "right",
      width: 130,
      render: (_, item) => (
        <Space size={2}>
          <Tooltip title="查看详情">
            <Button
              className="icon-button"
              type="text"
              icon={<AppIcon name="general/eye" size={18} />}
              onClick={() => onDetail(item)}
            />
          </Tooltip>
          <Tooltip title={canMutate ? "录入库存" : "当前端点不支持此项写入"}>
            <Button
              className="icon-button"
              type="text"
              disabled={!canMutate}
              icon={
                <AppIcon
                  name="general/plus"
                  color={canMutate ? "primary" : "context"}
                  size={18}
                />
              }
              onClick={() => onCreateInventory(item)}
            />
          </Tooltip>
        </Space>
      ),
    },
  ];
  return (
    <Table<ReagentInfo>
      rowKey="reagentInfoUuid"
      columns={columns}
      dataSource={[...data]}
      locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无试剂目录" /> }}
      pagination={{ pageSize: 10, hideOnSinglePage: true }}
    />
  );
}
