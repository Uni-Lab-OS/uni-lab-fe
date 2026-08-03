/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 调试客户端统一外壳(顶栏 + 左侧导航 + 主区)
 * Context: 设备、物料与工作流共用框架
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { useCallback } from 'react';
import { useWorkbench } from '../context/WorkbenchContext';
import { useAuth } from '../context/AuthContext';
import {
  AppShellLayout,
  type AppShellNavigationItem
} from '@unilab/app-shell';
import ConnectionBar from './ConnectionBar';
import UserMenu from './auth/UserMenu';
import ErrorBoundary from './ErrorBoundary';
import DevicePanel from './device/DevicePanel';
import DeviceCardWorkbench from './device-cards/DeviceCardWorkbench';
import { LabPanelWorkspace } from '../integrations/lab-workbench/LabPanelWorkspace';
import type { WorkbenchSection } from '../data/lab';

const DEVICE_NAV_ITEM: AppShellNavigationItem = {
  id: 'device',
  label: '仪器设备',
  icon: <DeviceIcon />
};
const CARD_NAV_ITEM: AppShellNavigationItem = {
  id: 'cards',
  label: '设备卡片',
  icon: '▣'
};
const MATERIAL_NAV_ITEM: AppShellNavigationItem = {
  id: 'material',
  label: '物料',
  icon: <MaterialIcon />
};
const WORKFLOW_NAV_ITEM: AppShellNavigationItem = {
  id: 'workflow',
  label: '工作流',
  icon: <WorkflowIcon />
};
const NAV_ITEMS: readonly AppShellNavigationItem[] = [
  DEVICE_NAV_ITEM,
  CARD_NAV_ITEM,
  MATERIAL_NAV_ITEM,
  WORKFLOW_NAV_ITEM
];

// 统一外壳:顶栏 + 左侧导航 + 主区
export default function AppShell(): React.JSX.Element {
  const { section, setSection } = useWorkbench();
  const { session, logout } = useAuth();
  const handleNavigate = useCallback(
    (navigationId: string) => {
      const nextSection = navigationId as WorkbenchSection;
      if (nextSection === section) return;
      setSection(nextSection);
    },
    [section, setSection]
  );

  return (
    <AppShellLayout
      brand="Uni-Lab 调试台"
      topbar={
        <>
          <ConnectionBar />
          {session ? (
            <UserMenu userInfo={session.userInfo} onLogout={logout} />
          ) : null}
        </>
      }
      navigation={NAV_ITEMS}
      activeNavigationId={section}
      onNavigate={handleNavigate}
    >
      <SectionView section={section} />
    </AppShellLayout>
  );
}

// 根据当前方向渲染对应面板
function SectionView({ section }: {
  section: WorkbenchSection;
}): React.JSX.Element {
  if (section === 'device') return <DevicePanel />;
  if (section === 'cards') return <DeviceCardWorkbench />;
  if (section === 'material') {
    return (
      <LabPanelWorkspace
        key="material-workspace"
        preset="lab"
      />
    );
  }
  if (section === 'scene') {
    // 3D 场景内部依赖 Pascal/WebGPU，运行时报错时用错误边界兜底，避免整页崩溃
    return (
      <ErrorBoundary title="3D 场景加载失败">
        <LabPanelWorkspace key="scene-workspace" preset="scene" />
      </ErrorBoundary>
    );
  }
  return (
    <LabPanelWorkspace
      key="workflow-workspace"
      preset="workflow"
    />
  );
}

function DeviceIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <rect x="5" y="6" width="6" height="4" rx="0.75" />
      <circle cx="14.25" cy="8" r="1.25" />
      <path d="M5 13.5h5.5M13 13.5h1.5" />
    </svg>
  );
}

function MaterialIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m10 2.5 6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5L10 2.5Z" />
      <path d="m3.8 6.4 6.2 3.5 6.2-3.5M10 9.9v7.2" />
    </svg>
  );
}

function SceneIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="m10 2 7 4v8l-7 4-7-4V6l7-4Z" />
      <path d="m3.4 6.2 6.6 3.7 6.6-3.7M10 9.9v7.7" />
    </svg>
  );
}

function WorkflowIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect x="2.5" y="2.5" width="5" height="4" rx="1" />
      <rect x="12.5" y="2.5" width="5" height="4" rx="1" />
      <rect x="7.5" y="13.5" width="5" height="4" rx="1" />
      <path d="M5 6.5V9h5v4.5M15 6.5V9h-5" />
    </svg>
  );
}
