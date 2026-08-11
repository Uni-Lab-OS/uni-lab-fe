/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: 调试客户端统一外壳(顶栏 + 左侧导航 + 主区)
 * Context: 设备、物料、试剂与工作流共用框架
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { useCallback, useEffect, useRef, useState } from 'react';
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
import DeviceSquarePanel from './device-provisioning/DeviceSquarePanel';
import DeviceCardWorkbench from './device-cards/DeviceCardWorkbench';
import ReagentPanel from './reagent/ReagentPanel';
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
const DEVICE_SQUARE_NAV_ITEM: AppShellNavigationItem = {
  id: 'device-square',
  label: '设备广场',
  icon: <DeviceSquareIcon />
};
const MATERIAL_NAV_ITEM: AppShellNavigationItem = {
  id: 'material',
  label: '物料',
  icon: <MaterialIcon />
};
const REAGENT_NAV_ITEM: AppShellNavigationItem = {
  id: 'reagent',
  label: '试剂',
  icon: <ReagentIcon />
};
const WORKFLOW_NAV_ITEM: AppShellNavigationItem = {
  id: 'workflow',
  label: '工作流',
  icon: <WorkflowIcon />
};
const NAV_ITEMS: readonly AppShellNavigationItem[] = [
  DEVICE_NAV_ITEM,
  DEVICE_SQUARE_NAV_ITEM,
  CARD_NAV_ITEM,
  MATERIAL_NAV_ITEM,
  REAGENT_NAV_ITEM,
  WORKFLOW_NAV_ITEM
];

// 统一外壳:顶栏 + 左侧导航 + 主区
export default function AppShell(): React.JSX.Element {
  const { section, setSection } = useWorkbench();
  const { session, logout } = useAuth();
  const [workflowCatalogRequestRevision, setWorkflowCatalogRequestRevision] =
    useState(0);
  const dirtyWorkflowSections = useRef<Set<WorkbenchSection>>(new Set());
  const handleNavigate = useCallback(
    (navigationId: string) => {
      const nextSection = navigationId as WorkbenchSection;
      if (nextSection === section) {
        if (nextSection === 'workflow') {
          setWorkflowCatalogRequestRevision((revision) => revision + 1);
        }
        return;
      }
      setSection(nextSection);
    },
    [section, setSection]
  );
  const handleWorkflowUnsavedChangesChange = useCallback((
    sourceSection: WorkbenchSection,
    hasUnsavedChanges: boolean
  ) => {
    const dirtySections = dirtyWorkflowSections.current;
    const wasDirty = dirtySections.size > 0;
    if (hasUnsavedChanges) dirtySections.add(sourceSection);
    else dirtySections.delete(sourceSection);
    const isDirty = dirtySections.size > 0;
    if (wasDirty === isDirty) return;
    if (isDirty) {
      globalThis.addEventListener('beforeunload', preventUnsavedUnload);
    } else {
      globalThis.removeEventListener('beforeunload', preventUnsavedUnload);
    }
  }, []);

  useEffect(
    () => () => {
      globalThis.removeEventListener('beforeunload', preventUnsavedUnload);
    },
    []
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
      <VisitedSectionViews
        section={section}
        workflowCatalogRequestRevision={workflowCatalogRequestRevision}
        onWorkflowUnsavedChangesChange={handleWorkflowUnsavedChangesChange}
      />
    </AppShellLayout>
  );
}

function preventUnsavedUnload(event: BeforeUnloadEvent): void {
  event.preventDefault();
  event.returnValue = '';
}

// 已访问的功能面板只切换可见性，避免导航时丢失未保存的工作流草稿。
function VisitedSectionViews({
  section,
  workflowCatalogRequestRevision,
  onWorkflowUnsavedChangesChange
}: {
  section: WorkbenchSection;
  workflowCatalogRequestRevision: number;
  onWorkflowUnsavedChangesChange: (
    section: WorkbenchSection,
    hasUnsavedChanges: boolean
  ) => void;
}): React.JSX.Element {
  const [visited, setVisited] = useState<Set<WorkbenchSection>>(
    () => new Set([section])
  );

  useEffect(() => {
    setVisited((current) => {
      if (current.has(section)) return current;
      const next = new Set(current);
      next.add(section);
      return next;
    });
  }, [section]);

  return (
    <>
      {([...visited] as WorkbenchSection[]).map((visitedSection) => (
        <div
          key={visitedSection}
          hidden={visitedSection !== section}
          style={{ height: '100%', minHeight: 0 }}
        >
          <SectionView
            section={visitedSection}
            workflowCatalogRequestRevision={workflowCatalogRequestRevision}
            onWorkflowUnsavedChangesChange={onWorkflowUnsavedChangesChange}
          />
        </div>
      ))}
    </>
  );
}

/**
 * 根据当前一级模块渲染保持挂载的功能工作区。
 * @param props 当前模块、工作流目录命令版本与未保存状态回调。
 * @returns 仪器设备、物料、试剂或工作流的独立页面。
 */
function SectionView({
  section,
  workflowCatalogRequestRevision,
  onWorkflowUnsavedChangesChange
}: {
  section: WorkbenchSection;
  workflowCatalogRequestRevision: number;
  onWorkflowUnsavedChangesChange: (
    section: WorkbenchSection,
    hasUnsavedChanges: boolean
  ) => void;
}): React.JSX.Element {
  const handleWorkflowUnsavedChangesChange = useCallback(
    (hasUnsavedChanges: boolean) => {
      onWorkflowUnsavedChangesChange(section, hasUnsavedChanges);
    },
    [onWorkflowUnsavedChangesChange, section]
  );

  if (section === 'device') return <DevicePanel />;
  if (section === 'device-square') return <DeviceSquarePanel />;
  if (section === 'cards') return <DeviceCardWorkbench />;
  if (section === 'material') {
    return (
      <LabPanelWorkspace
        key="material-workspace"
        preset="lab"
        onWorkflowUnsavedChangesChange={handleWorkflowUnsavedChangesChange}
      />
    );
  }
  if (section === 'reagent') return <ReagentPanel />;
  if (section === 'scene') {
    // 3D 场景内部依赖 Pascal/WebGPU，运行时报错时用错误边界兜底，避免整页崩溃
    return (
      <ErrorBoundary title="3D 场景加载失败">
        <LabPanelWorkspace
          key="scene-workspace"
          preset="scene"
          onWorkflowUnsavedChangesChange={handleWorkflowUnsavedChangesChange}
        />
      </ErrorBoundary>
    );
  }
  return (
    <LabPanelWorkspace
      key="workflow-workspace"
      preset="workflow"
      workflowCatalogRequestRevision={workflowCatalogRequestRevision}
      onWorkflowUnsavedChangesChange={handleWorkflowUnsavedChangesChange}
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

// 云端设备定义进入本地设备图的入口图标
function DeviceSquareIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M3 6.5h14M6.5 3v3.5M13.5 3v3.5" />
      <rect x="2.5" y="3" width="15" height="14" rx="2" />
      <path d="M6 10h3v3H6zM11 10h3v3h-3z" />
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

/**
 * 绘制独立试剂模块的烧瓶导航标识。
 * @returns 不参与辅助技术命名的线性 SVG 图标。
 */
function ReagentIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <path d="M7 2.5h6M8.5 2.5v5l-4.6 7.4A1.7 1.7 0 0 0 5.35 17.5h9.3a1.7 1.7 0 0 0 1.45-2.6L11.5 7.5v-5" />
      <path d="M6.2 13h7.6M7.4 10.8h5.2" />
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
