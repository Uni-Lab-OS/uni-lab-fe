import { Typography } from "antd";
import type { ReactNode } from "react";

export function PageHeader({
  title,
  leading,
  actions,
}: {
  title: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header-title-row">
        {leading}
        <Typography.Title className="page-header-title" level={1}>
          {title}
        </Typography.Title>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
