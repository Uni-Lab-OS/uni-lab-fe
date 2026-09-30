import { cx } from "../../styles/styleMaps";
import { Input, Modal, Spin, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";
import { EmptyState } from "@unilab/design-v2";
import type {
  DeviceSummary,
  PublishedWorkflowRevisionSummary,
} from "@unilab-fe/core";
import { AppIcon } from "../../components/ui/Icon";
import { useBackendQuery } from "../../hooks/useBackendQuery";

export type DebugTargetKind = "device" | "workflow";

export interface DebugTarget {
  readonly kind: DebugTargetKind;
  readonly uuid: string;
}

export function DebugTargetModal({
  kind,
  onCancel,
  onConfirm,
}: {
  kind: DebugTargetKind | null;
  onCancel: () => void;
  onConfirm: (target: DebugTarget) => void;
}) {
  const deviceQuery = useBackendQuery(`debug-target-devices-${kind}`, (backend) =>
    kind === "device" ? backend.core.deviceActions.listDevices() : Promise.resolve([]),
  );
  const workflowQuery = useBackendQuery(`debug-target-workflows-${kind}`, (backend) =>
    kind === "workflow"
      ? backend.core.workflowDefinitions.listPublishedRevisions({
          page: 1,
          pageSize: 200,
          status: "all",
        })
      : Promise.resolve([]),
  );
  const [keyword, setKeyword] = useState("");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  useEffect(() => {
    setKeyword("");
    setSelectedUuid(null);
  }, [kind]);

  const devices = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return (deviceQuery.data ?? []).filter((device) =>
      `${device.label} ${device.deviceKey} ${device.namespace}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [deviceQuery.data, keyword]);
  const workflows = useMemo(() => {
    const normalized = keyword.trim().toLowerCase();
    return (workflowQuery.data ?? []).filter((workflow) =>
      `${workflow.name} ${workflow.workflowUuid}`.toLowerCase().includes(normalized),
    );
  }, [keyword, workflowQuery.data]);

  const loading = kind === "device" ? deviceQuery.loading : workflowQuery.loading;
  const error = kind === "device" ? deviceQuery.error : workflowQuery.error;
  const items = kind === "device" ? devices : workflows;

  return (
    <Modal
      open={kind !== null}
      title={kind === "device" ? "选择要调试的设备" : "选择要调试的工作流"}
      okText="进入调试"
      cancelText="取消"
      width={640}
      okButtonProps={{ disabled: !selectedUuid }}
      onCancel={onCancel}
      onOk={() => {
        if (kind && selectedUuid) onConfirm({ kind, uuid: selectedUuid });
      }}
      destroyOnHidden
    >
      <div className={cx("debug-target-picker")}>
        <Input
          allowClear
          autoFocus
          prefix={<AppIcon name="general/search-md" size={16} />}
          placeholder={kind === "device" ? "搜索设备名称、设备键" : "搜索工作流名称或 UUID"}
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <div className={cx("debug-target-picker__meta")}>
          <span>
            {kind === "device" ? `${devices.length} 台设备` : `${workflows.length} 个工作流`}
          </span>
          <span>请选择一项</span>
        </div>
        <div className={cx("debug-target-picker__list")} role="radiogroup" aria-label="调试对象">
          {loading ? (
            <div className={cx("debug-target-picker__state")}><Spin size="small" /></div>
          ) : error ? (
            <div className={cx("debug-target-picker__state debug-target-picker__state--error")}>
              {error.message}
            </div>
          ) : items.length === 0 ? (
            <EmptyState
              className={cx("debug-target-picker__empty")}
              scene="no-results"
              size="compact"
              title="没有匹配的对象"
            />
          ) : kind === "device" ? (
            devices.map((device) => (
              <DeviceOption
                key={device.deviceUuid}
                device={device}
                selected={selectedUuid === device.deviceUuid}
                onSelect={setSelectedUuid}
              />
            ))
          ) : (
            workflows.map((workflow) => (
              <WorkflowOption
                key={workflow.workflowUuid}
                workflow={workflow}
                selected={selectedUuid === workflow.workflowUuid}
                onSelect={setSelectedUuid}
              />
            ))
          )}
        </div>
      </div>
    </Modal>
  );
}

function DeviceOption({
  device,
  selected,
  onSelect,
}: {
  device: DeviceSummary;
  selected: boolean;
  onSelect: (uuid: string) => void;
}) {
  // 设备离线时仍允许进入详情，便于查看设备包和动作定义；真正执行动作时
  // 由设备详情页根据 dispatchable 状态阻止提交。
  const unavailable = device.online === false || device.dispatchable === false;
  const availabilityLabel =
    device.online === false
      ? "离线"
      : device.dispatchable === false
        ? device.dispatchBlockReason ?? "不可调试"
        : device.dispatchable === null
          ? "状态未知"
          : "可调试";
  return (
    <label
      className={cx(`debug-target-option ${selected ? "is-selected" : ""} ${unavailable ? "is-unavailable" : ""}`)}
    >
      <input
        className={cx("debug-target-option__radio")}
        type="radio"
        name="debug-target"
        checked={selected}
        onChange={() => onSelect(device.deviceUuid)}
      />
      <span className={cx("debug-target-option__copy")}>
        <strong>{device.label}</strong>
      </span>
      <Tag color={unavailable ? "default" : "green"}>
        {availabilityLabel}
      </Tag>
    </label>
  );
}

function WorkflowOption({
  workflow,
  selected,
  onSelect,
}: {
  workflow: PublishedWorkflowRevisionSummary;
  selected: boolean;
  onSelect: (uuid: string) => void;
}) {
  return (
    <label
      className={cx(`debug-target-option ${selected ? "is-selected" : ""}`)}
    >
      <input
        className={cx("debug-target-option__radio")}
        type="radio"
        name="debug-target"
        checked={selected}
        onChange={() => onSelect(workflow.workflowUuid)}
      />
      <span className={cx("debug-target-option__copy")}>
        <strong>{workflow.name}</strong>
        <small>版本 v{workflow.revision}</small>
      </span>
      <Tag color={workflow.status === "published" ? "green" : "default"}>
        {workflow.status === "published" ? "已发布" : "未发布"}
      </Tag>
    </label>
  );
}
