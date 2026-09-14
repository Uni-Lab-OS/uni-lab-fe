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
import { LabPanelWorkspace } from '../integrations/lab-workbench/LabPanelWorkspace';
import type { WorkbenchSection } from '../data/lab';
import { useServices } from '@unilab/services';
import {
  WorkflowTaskList,
  type WorkflowCatalogState
} from '@unilab/workflow-editor';

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
const WORKFLOW_NAV_ITEM: AppShellNavigationItem = {
  id: 'workflow',
  label: '工作流',
  icon: <WorkflowIcon />
};
const WORKFLOW_TASK_NAV_ITEM: AppShellNavigationItem = {
  id: 'workflow-tasks',
  label: '任务列表',
  icon: <WorkflowTaskIcon />
};
const NAV_ITEMS: readonly AppShellNavigationItem[] = [
  DEVICE_NAV_ITEM,
  DEVICE_SQUARE_NAV_ITEM,
  CARD_NAV_ITEM,
  MATERIAL_NAV_ITEM,
  WORKFLOW_NAV_ITEM,
  WORKFLOW_TASK_NAV_ITEM
];

// 统一外壳:顶栏 + 左侧导航 + 主区
export default function AppShell(): React.JSX.Element {
  const {
    section,
    setSection,
    recoveryRevision,
    reportCapabilityHealth
  } = useWorkbench();
  const { session, logout } = useAuth();
  const [workflowCatalogRequestRevision, setWorkflowCatalogRequestRevision] =
    useState(0);
  const dirtyWorkflowSections = useRef<Set<WorkbenchSection>>(new Set());
  const handleWorkflowCatalogStateChange = useCallback((
    state: WorkflowCatalogState
  ) => {
    reportCapabilityHealth('workflows', state);
  }, [reportCapabilityHealth]);
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
        recoveryRevision={recoveryRevision}
        onWorkflowCatalogStateChange={handleWorkflowCatalogStateChange}
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
  recoveryRevision,
  onWorkflowCatalogStateChange,
  onWorkflowUnsavedChangesChange
}: {
  section: WorkbenchSection;
  workflowCatalogRequestRevision: number;
  recoveryRevision: number;
  onWorkflowCatalogStateChange: (state: WorkflowCatalogState) => void;
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

  // 当前面板必须在本次渲染中同步出现。若只等 effect 更新 visited，
  // 旧面板会先被 hidden，新面板下一帧才挂载，首次导航时主区会整帧空白。
  const renderedSections = visited.has(section)
    ? visited
    : new Set([...visited, section]);

  return (
    <>
      {([...renderedSections] as WorkbenchSection[]).map((visitedSection) => (
        <div
          key={visitedSection}
          hidden={visitedSection !== section}
          style={{ height: '100%', minHeight: 0 }}
        >
          <SectionView
            section={visitedSection}
            active={visitedSection === section}
            workflowCatalogRequestRevision={workflowCatalogRequestRevision}
            recoveryRevision={recoveryRevision}
            onWorkflowCatalogStateChange={onWorkflowCatalogStateChange}
            onWorkflowUnsavedChangesChange={onWorkflowUnsavedChangesChange}
          />
        </div>
      ))}
    </>
  );
}

// 根据当前方向渲染对应面板
function SectionView({
  section,
  active,
  workflowCatalogRequestRevision,
  recoveryRevision,
  onWorkflowCatalogStateChange,
  onWorkflowUnsavedChangesChange
}: {
  section: WorkbenchSection;
  active: boolean;
  workflowCatalogRequestRevision: number;
  recoveryRevision: number;
  onWorkflowCatalogStateChange: (state: WorkflowCatalogState) => void;
  onWorkflowUnsavedChangesChange: (
    section: WorkbenchSection,
    hasUnsavedChanges: boolean
  ) => void;
}): React.JSX.Element {
  const services = useServices();
  const handleWorkflowUnsavedChangesChange = useCallback(
    (hasUnsavedChanges: boolean) => {
      onWorkflowUnsavedChangesChange(section, hasUnsavedChanges);
    },
    [onWorkflowUnsavedChangesChange, section]
  );

  if (section === 'device') return <DevicePanel />;
  if (section === 'device-square') return <DeviceSquarePanel />;
  if (section === 'cards') return <DeviceCardWorkbench />;
  if (section === 'workflow-tasks') {
    return (
      <WorkflowTaskList
        runtime={services.workflow}
        active={active}
        recoveryRevision={recoveryRevision}
      />
    );
  }
  if (section === 'material') {
    return (
      <>
        <h1 className="workbench-page-title">物料工作台</h1>
        <LabPanelWorkspace
          key="material-workspace"
          preset="lab"
          onWorkflowUnsavedChangesChange={handleWorkflowUnsavedChangesChange}
          recoveryRevision={recoveryRevision}
          onWorkflowCatalogStateChange={onWorkflowCatalogStateChange}
        />
      </>
    );
  }
  if (section === 'scene') {
    // 3D 场景内部依赖 Pascal/WebGPU，运行时报错时用错误边界兜底，避免整页崩溃
    return (
      <ErrorBoundary title="3D 场景加载失败">
        <h1 className="workbench-page-title">三维实验室场景</h1>
        <LabPanelWorkspace
          key="scene-workspace"
          preset="scene"
          onWorkflowUnsavedChangesChange={handleWorkflowUnsavedChangesChange}
          recoveryRevision={recoveryRevision}
          onWorkflowCatalogStateChange={onWorkflowCatalogStateChange}
        />
      </ErrorBoundary>
    );
  }
  return (
    <>
      <h1 className="workbench-page-title">工作流工作台</h1>
      <LabPanelWorkspace
        key="workflow-workspace"
        preset="workflow"
        workflowCatalogRequestRevision={workflowCatalogRequestRevision}
        recoveryRevision={recoveryRevision}
        onWorkflowCatalogStateChange={onWorkflowCatalogStateChange}
        onWorkflowUnsavedChangesChange={handleWorkflowUnsavedChangesChange}
      />
    </>
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

function WorkflowTaskIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20">
      <rect x="3" y="2.5" width="14" height="15" rx="2" />
      <path d="M6.5 6h7M6.5 10h7M6.5 14h4" />
      <circle cx="5" cy="6" r=".5" fill="currentColor" stroke="none" />
      <circle cx="5" cy="10" r=".5" fill="currentColor" stroke="none" />
      <circle cx="5" cy="14" r=".5" fill="currentColor" stroke="none" />
    </svg>
  );
}
