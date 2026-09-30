import { cx } from "../../styles/styleMaps";
import { Button, Input, Table, Tooltip } from "antd";
import type { TableColumnsType } from "antd";
import { useEffect, useMemo, useState } from "react";
import type { DeviceSummary } from "@unilab-fe/core";
import { DeviceStatusBadge } from "@unilab/lab-ui";
import { EmptyState } from "@unilab/design-v2";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import { AppIcon } from "../../components/ui/Icon";
import { AsyncState } from "../../components/ui/AsyncState";
import { PageHeader } from "../../components/ui/PageHeader";
import { DeviceDetail } from "./DeviceDetailPage";
import { TableText } from "../../components/ui/TableText";

export function DevicesPage() {
  const query = useBackendQuery("devices", (backend) =>
    backend.core.deviceActions.listDevices(),
  );
  const [selected, setSelected] = useState<DeviceSummary | null>(null);
  const [debugDeviceUuid, setDebugDeviceUuid] = useState(() =>
    new URLSearchParams(window.location.search).get("debugDevice"),
  );
  const [startDebug, setStartDebug] = useState(false);
  const [keyword, setKeyword] = useState("");
  const rows = useMemo(
    () =>
      (query.data ?? []).filter((device) =>
        `${device.label} ${device.deviceKey}`
          .toLowerCase()
          .includes(keyword.toLowerCase()),
      ),
    [keyword, query.data],
  );
  useEffect(() => {
    if (!debugDeviceUuid || !query.data || selected) return;
    const device = query.data.find((item) => item.deviceUuid === debugDeviceUuid);
    if (!device) return;
    setSelected(device);
    setStartDebug(true);
    // 入口参数只消费一次，返回设备列表后不能再次触发自动选中。
    setDebugDeviceUuid(null);
    window.history.replaceState({}, "", "/devices");
  }, [debugDeviceUuid, query.data, selected]);

  if (selected)
    return (
      <DeviceDetail
        device={selected}
        startDebug={startDebug}
        onBack={() => {
          setSelected(null);
          setStartDebug(false);
        }}
      />
    );
  return (
    <div className={cx("page-stack devices-list-page")}>
      <PageHeader
        title="设备"
        actions={
          <Input
            className={cx("search-input device-page-search")}
            allowClear
            prefix={<AppIcon name="general/search-md" size={16} />}
            placeholder="搜索设备名称或设备键"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        }
      />
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        empty={!query.loading && rows.length === 0}
        emptyDescription={keyword ? "没有匹配的设备" : "后端没有返回设备"}
        variant="table"
        tableColumns={5}
      >
        <section className={cx("data-section")}>
          <DeviceTable rows={rows} onView={setSelected} />
        </section>
      </AsyncState>
    </div>
  );
}

function DeviceTable({
  rows,
  onView,
}: {
  rows: readonly DeviceSummary[];
  onView: (device: DeviceSummary) => void;
}) {
  const columns: TableColumnsType<DeviceSummary> = [
    {
      title: "设备",
      key: "device",
      width: 360,
      render: (_, row) => (
        <div className={cx("device-cell")}>
          <button
            type="button"
            className={cx("device-cell__name")}
            onClick={() => onView(row)}
          >
            <TableText text={row.label} />
          </button>
        </div>
      ),
    },
    {
      title: "动作",
      key: "actions",
      width: 120,
      align: "center",
      render: (_, row) => (
        <span className={cx("muted-cell")}>{row.actions.length} 个动作</span>
      ),
    },
    {
      title: "状态",
      key: "state",
      align: "center",
      render: (_, row) => {
        return <DeviceStatusBadge device={row} />;
      },
    },
    {
      title: "当前动作",
      key: "current",
      width: 170,
      align: "center",
      render: (_, row) => {
        const busy = row.actions.find((action) => action.isBusy);
        return busy ? (
          <span className={cx("muted-cell")}>{busy.label}</span>
        ) : (
          <span className={cx("muted-cell")}>空闲</span>
        );
      },
    },
    {
      title: "操作",
      key: "operation",
      align: "center",
      width: 100,
      render: (_, row) => (
        <Tooltip title="查看设备">
          <Button
            className={cx("icon-button")}
            type="text"
            icon={<AppIcon name="general/eye" size={18} />}
            aria-label={`查看设备 ${row.label}`}
            onClick={() => onView(row)}
          />
        </Tooltip>
      ),
    },
  ];
  return (
    <Table<DeviceSummary>
      rowKey="deviceUuid"
      className={cx("device-table")}
      columns={columns}
      dataSource={rows}
      locale={{ emptyText: <EmptyState scene="no-data" size="compact" title="暂无设备" /> }}
      pagination={{
        pageSize: 10,
        hideOnSinglePage: false,
        showSizeChanger: false,
        showTotal: (total, range) => `${range[0]}-${range[1]} / 共 ${total} 台设备`,
      }}
    />
  );
}
