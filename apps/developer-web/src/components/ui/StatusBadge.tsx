import {
  StatusBadge as LabStatusBadge,
  statusMeta,
  type StatusTone as LabStatusTone,
} from "@unilab/lab-ui";
import { cx } from "../../styles/styleMaps";

export type StatusTone = LabStatusTone;

export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  return (
    <LabStatusBadge
      status={status}
      meta={statusMeta(status)}
      label={label}
      className={cx("status-badge")}
    />
  );
}
