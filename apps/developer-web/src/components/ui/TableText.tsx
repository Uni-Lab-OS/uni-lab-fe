import { cx } from "../../styles/styleMaps";
import { Typography } from "antd";
import type { CSSProperties } from "react";

export function TableText({
  text,
  className,
  style,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <Typography.Text
      className={cx(["table-text", className].filter(Boolean).join(" "))}
      ellipsis={{ tooltip: text }}
      style={{ display: "block", maxWidth: "100%", ...style }}
    >
      {text}
    </Typography.Text>
  );
}
