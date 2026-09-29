import { type ReactNode, useState } from "react";
import { Badge, Button, Tooltip } from "antd";
import type { IconName } from "@unilab/design-v2/icons";
import { useBackend } from "../app/BackendProvider";
import { AppIcon } from "./ui/Icon";

export type StudioRoute =
  | "overview"
  | "devices"
  | "reagents"
  | "materials"
  | "workflows"
  | "tasks";

const navigation: readonly {
  key: StudioRoute;
  label: string;
  icon: IconName;
}[] = [
  { key: "overview", label: "总览", icon: "general/home-02" },
  { key: "workflows", label: "工作流", icon: "development/dataflow-01" },
  { key: "tasks", label: "任务", icon: "time/clock" },
  { key: "devices", label: "设备", icon: "development/cpu-chip-01" },
  { key: "reagents", label: "试剂", icon: "education/beaker-01" },
  { key: "materials", label: "物料", icon: "shapes/cube-03" },
];

export function AppShell({
  route,
  onNavigate,
  children,
}: {
  route: StudioRoute;
  onNavigate: (route: StudioRoute) => void;
  children: ReactNode;
}) {
  const { connection } = useBackend();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  return (
    <div className={`studio-shell ${sidebarCollapsed ? "studio-shell--collapsed" : ""}`}>
      <aside className="studio-sidebar">
        <div className="studio-brand">
          <span className="studio-brand-mark">U</span>
          <div className="studio-brand-copy">
            <strong>Uni-Lab</strong>
          </div>
          <Button
            type="text"
            className="studio-sidebar-toggle"
            aria-label={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            aria-expanded={!sidebarCollapsed}
            title={sidebarCollapsed ? "展开侧边栏" : "收起侧边栏"}
            icon={
              <AppIcon
                name={sidebarCollapsed ? "arrows/chevron-right" : "arrows/chevron-left"}
                size={16}
              />
            }
            onClick={() => setSidebarCollapsed((value) => !value)}
          />
        </div>
        <nav className="studio-nav" aria-label="主导航">
          <span className="studio-nav-label">工作台</span>
          {navigation.slice(0, 3).map((item) => (
            <NavItem
              key={item.key}
              item={item}
              route={route}
              connection={connection}
              collapsed={sidebarCollapsed}
              onNavigate={onNavigate}
            />
          ))}
          <span className="studio-nav-label studio-nav-label--resources">资源</span>
          {navigation.slice(3).map((item) => (
            <NavItem
              key={item.key}
              item={item}
              route={route}
              connection={connection}
              collapsed={sidebarCollapsed}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
      </aside>
      <div className={`studio-main studio-main--${route}`}>
        <main className={`studio-content studio-content--${route}`}>{children}</main>
      </div>
    </div>
  );
}

function NavItem({
  item,
  route,
  connection,
  collapsed,
  onNavigate,
}: {
  item: (typeof navigation)[number];
  route: StudioRoute;
  connection: "unknown" | "connected" | "error";
  collapsed: boolean;
  onNavigate: (route: StudioRoute) => void;
}) {
  const navButton = (
    <button
      type="button"
      className={`studio-nav-item ${route === item.key ? "is-active" : ""}`}
      aria-label={collapsed ? item.label : undefined}
      onClick={() => onNavigate(item.key)}
    >
      <AppIcon
        name={item.icon}
        size={16}
        color={route === item.key ? "primary" : "context"}
      />
      <span className="studio-nav-item__label">{item.label}</span>
      {item.key === "overview" && (
        <Badge count={connection === "error" ? 1 : 0} size="small" />
      )}
    </button>
  );

  return collapsed ? (
    <Tooltip title={item.label} placement="right">
      {navButton}
    </Tooltip>
  ) : (
    navButton
  );
}
