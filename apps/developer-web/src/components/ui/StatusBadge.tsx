import { cx } from "../../styles/styleMaps";
import { Tag } from "antd";
import type { IconName } from "@unilab/design-v2/icons";
import { AppIcon } from "./Icon";

export type StatusTone =
  | "success"
  | "processing"
  | "warning"
  | "error"
  | "default";

const statuses: Record<
  string,
  { label: string; tone: StatusTone; icon: IconName }
> = {
  success: { label: "已完成", tone: "success", icon: "general/check-circle" },
  completed: { label: "已完成", tone: "success", icon: "general/check-circle" },
  // 运行中必须是橙色：蓝色留给"暂停在节点之前"，见 AGENTS.md 颜色约定。
  running: { label: "执行中", tone: "warning", icon: "media/play-circle" },
  canceled: { label: "已取消", tone: "default", icon: "general/slash-circle-01" },
  cancelled: { label: "已取消", tone: "default", icon: "general/slash-circle-01" },
  timeout: { label: "已超时", tone: "error", icon: "alerts-feedback/alert-circle" },
  waiting: { label: "等待中", tone: "warning", icon: "time/clock" },
  queued: { label: "待调度", tone: "warning", icon: "time/clock" },
  blocked: {
    label: "阻断",
    tone: "error",
    icon: "alerts-feedback/alert-circle",
  },
  failed: {
    label: "失败",
    tone: "error",
    icon: "alerts-feedback/alert-circle",
  },
  attention: {
    label: "异常",
    tone: "error",
    icon: "alerts-feedback/alert-circle",
  },
  offline: { label: "离线", tone: "default", icon: "general/slash-circle-01" },
  available: { label: "可用", tone: "success", icon: "general/check-circle" },
  empty: { label: "空", tone: "default", icon: "general/minus-circle" },
  quarantined: {
    label: "隔离",
    tone: "error",
    icon: "alerts-feedback/alert-circle",
  },
  // NodeJob / 调试时间线的节点状态，与 Task 生命周期共用同一套色调和胶囊。
  manual: {
    label: "待人工确认",
    tone: "warning",
    icon: "users/user-check-01",
  },
  unknown: {
    label: "结果待核对",
    tone: "error",
    icon: "general/help-circle",
  },
  pending: { label: "未到达", tone: "default", icon: "general/minus-circle" },
  skipped: { label: "已跳过", tone: "default", icon: "media/skip-forward" },
};

export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const meta = statuses[status.toLowerCase()] ?? {
    label: status,
    tone: "default" as const,
    icon: "general/info-circle" as IconName,
  };
  return (
    <Tag
      className={cx("status-badge")}
      color={meta.tone}
      icon={
        <AppIcon
          name={meta.icon}
          size={14}
          color={
            meta.tone === "error"
              ? "error"
              : meta.tone === "success"
                ? "success"
                : meta.tone === "default"
                  ? "default"
                  : meta.tone === "processing"
                    ? "primary"
                    : // 图标没有 warning 色阶，继承胶囊文字色才能和标签同色。
                    meta.tone === "warning"
                      ? "inherit"
                      : "context"
          }
        />
      }
    >
      {label ?? meta.label}
    </Tag>
  );
}
