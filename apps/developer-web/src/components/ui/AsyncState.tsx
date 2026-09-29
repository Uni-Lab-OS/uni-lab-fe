import { Alert, Skeleton } from "antd";
import { EmptyState } from "@unilab/design-v2";
import type { ReactNode } from "react";

export function AsyncState({
  loading,
  error,
  onRetry,
  children,
  empty = false,
  emptyDescription = "暂无数据",
  variant = "default",
  tableColumns = 5,
}: {
  loading: boolean;
  error?: Error;
  onRetry: () => void;
  children: ReactNode;
  empty?: boolean;
  emptyDescription?: string;
  variant?: "default" | "table";
  tableColumns?: number;
}) {
  if (loading)
    return (
      <div className={`async-state${variant === "table" ? " async-state--table" : ""}`}>
        {variant === "table" ? (
          <TableSkeleton columns={tableColumns} />
        ) : (
          <Skeleton active paragraph={{ rows: 5 }} />
        )}
      </div>
    );
  if (error)
    return (
      <Alert
        className="async-error"
        type="error"
        showIcon
        message="数据加载失败"
        description={error.message}
        action={
          <button type="button" className="text-action" onClick={onRetry}>
            重试
          </button>
        }
      />
    );
  if (empty)
    return <EmptyState className="async-empty" title={emptyDescription} />;
  return <>{children}</>;
}

function TableSkeleton({ columns }: { columns: number }) {
  const safeColumns = Math.max(2, Math.floor(columns));
  return (
    <div className="table-skeleton" role="status" aria-label="正在加载表格">
      {Array.from({ length: 6 }, (_, rowIndex) => (
        <div
          className="table-skeleton-row"
          key={rowIndex}
          style={{
            gridTemplateColumns: `minmax(220px, 2fr) repeat(${safeColumns - 1}, minmax(76px, 1fr))`,
          }}
        >
          {Array.from({ length: safeColumns }, (_, columnIndex) => (
            <span
              className={`table-skeleton-cell${columnIndex === 0 ? " table-skeleton-cell--primary" : ""}`}
              key={columnIndex}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
