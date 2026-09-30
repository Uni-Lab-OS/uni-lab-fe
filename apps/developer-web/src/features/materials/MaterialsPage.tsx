import { cx } from "../../styles/styleMaps";
import { Button, Empty, Input, Tooltip, Tree, Typography } from "antd";
import type { TreeDataNode } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState } from "@unilab/design-v2";
import ChevronDownIcon from "@unilab/design-v2/icons/static/arrows/chevron-down";
import ChevronRightIcon from "@unilab/design-v2/icons/static/arrows/chevron-right";
import type { MaterialGraphNode, SiteSummary } from "@unilab-fe/core";
import type { IconColor, IconName } from "@unilab/design-v2/icons";
import {
  MaterialInspector as LabMaterialInspector,
  SitePicker,
} from "@unilab/lab-ui";
import { useBackendQuery } from "../../hooks/useBackendQuery";
import { AppIcon } from "../../components/ui/Icon";
import { AsyncState } from "../../components/ui/AsyncState";
import { PageHeader } from "../../components/ui/PageHeader";
import { StatusBadge } from "../../components/ui/StatusBadge";
import {
  isMaterialGraphNodeHidden,
  MaterialFlowCanvas,
  type MaterialSelection,
} from "./MaterialFlowCanvas";

export function MaterialsPage() {
  const query = useBackendQuery("material-graph", (backend) =>
    backend.core.materialSite.getGraph(),
  );
  const [selection, setSelection] = useState<MaterialSelection | null>(null);
  const [keyword, setKeyword] = useState("");
  const [management, setManagement] = useState(false);
  const allNodes = query.data?.nodes ?? [];
  const nodeById = useMemo(
    () => new Map(allNodes.map((node) => [node.material.materialUuid, node])),
    [allNodes],
  );
  const handleSelection = useCallback((next: MaterialSelection) => {
    if (next.kind !== "node") {
      setSelection(next);
      return;
    }
    let selected = nodeById.get(next.nodeId);
    const visited = new Set<string>();
    while (selected && isMaterialGraphNodeHidden(selected) && selected.material.parentMaterialUuid) {
      if (visited.has(selected.material.materialUuid)) break;
      visited.add(selected.material.materialUuid);
      const parent = nodeById.get(selected.material.parentMaterialUuid);
      if (!parent) break;
      selected = parent;
      if (!isMaterialGraphNodeHidden(selected)) break;
    }
    setSelection({ kind: "node", nodeId: selected?.material.materialUuid ?? next.nodeId });
  }, [nodeById]);
  const normalizedKeyword = keyword.trim().toLowerCase();
  const matchingIds = useMemo(
    () => new Set(
      normalizedKeyword
        ? allNodes
          .filter((node) =>
            `${node.material.name} ${node.material.barcode ?? ""}`
              .toLowerCase()
              .includes(normalizedKeyword),
          )
          .map((node) => node.material.materialUuid)
        : [],
    ),
    [allNodes, normalizedKeyword],
  );
  const selectedSite = selection?.kind === "site" || selection?.kind === "material"
    ? allNodes.flatMap((node) => node.sites).find((site) =>
      site.siteUuid === (selection.kind === "site" ? selection.siteId : selection.siteId),
    )
    : undefined;
  const selected = selection
    ? nodeById.get(selection.kind === "node" ? selection.nodeId : selection.kind === "material" ? selection.materialId : selectedSite?.ownerMaterialUuid ?? "")
    : undefined;
  if (management)
    return (
      <MaterialManagement
        graph={query.data}
        onBack={() => setManagement(false)}
      />
    );
  return (
    <div className={cx("page-stack")}>
      <PageHeader
        title="物料"
        actions={
          <Button
            icon={<AppIcon name="layout/layers-three-01" size={16} />}
            onClick={() => setManagement(true)}
          >
            物料管理
          </Button>
        }
      />
      <AsyncState
        loading={query.loading}
        error={query.error}
        onRetry={query.reload}
        empty={!query.loading && allNodes.length === 0}
        emptyDescription="后端没有返回物料图"
      >
        <div className={cx("resource-toolbar")}>
          <Input
            className={cx("search-input")}
            allowClear
            prefix={<AppIcon name="general/search-md" size={16} />}
            placeholder="搜索物料名称或条码"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <span className={cx(`toolbar-hint ${normalizedKeyword ? "is-searching" : ""}`)} aria-live="polite">
            {normalizedKeyword
              ? `${matchingIds.size} / ${allNodes.length} 个节点匹配`
              : `${allNodes.length} 个节点`}
          </span>
        </div>
        <div className={cx("material-workspace")}>
          <MaterialFlowCanvas
            nodes={allNodes}
            hasSearch={Boolean(normalizedKeyword)}
            highlightedIds={matchingIds}
            selectedId={selection?.kind === "material" ? selection.materialId : selection?.kind === "node" ? selection.nodeId : undefined}
            selectedSiteId={selection?.kind === "material" ? selection.siteId : selection?.kind === "site" ? selection.siteId : undefined}
            onSelect={handleSelection}
          />
          <MaterialInspector
            node={selected}
            nodes={allNodes}
            selectedSite={selectedSite}
            selection={selection}
            onSelect={handleSelection}
          />
        </div>
      </AsyncState>
    </div>
  );
}

function MaterialInspector({
  node,
  nodes,
  selectedSite,
  selection,
  onSelect,
}: {
  node?: MaterialGraphNode;
  nodes: readonly MaterialGraphNode[];
  selectedSite?: SiteSummary;
  selection: MaterialSelection | null;
  onSelect: (selection: MaterialSelection) => void;
}) {
  if (!node || !selection)
    return (
      <aside className={cx("material-inspector material-inspector--empty")}>
        <EmptyState scene="no-data" title="选择节点、库位或物料查看详情" />
      </aside>
    );

  if (selection.kind === "site" && selectedSite) {
    return (
      <SiteInspector
        node={node}
        site={selectedSite}
        onSelect={onSelect}
      />
    );
  }

  if (selection.kind === "node") {
    return <NodeInspector node={node} nodes={nodes} onSelect={onSelect} />;
  }

  return (
    <MaterialDetailInspector
      node={node}
      selectedSite={selectedSite}
      onSelect={onSelect}
    />
  );
}

function InspectorHeading({
  icon,
  title,
  iconColor = "primary",
}: {
  icon: IconName;
  title: string;
  iconColor?: IconColor;
}) {
  return (
    <div className={cx("inspector-heading")}>
      <span className={cx("inspector-icon")}>
        <AppIcon name={icon} color={iconColor} size={22} />
      </span>
      <div>
        <h2>{title}</h2>
      </div>
    </div>
  );
}

function NodeInspector({
  node,
  nodes,
  onSelect,
}: {
  node: MaterialGraphNode;
  nodes: readonly MaterialGraphNode[];
  onSelect: (selection: MaterialSelection) => void;
}) {
  const detail = node.material;
  const sites = collectNodeSites(node, nodes);
  return (
    <aside className={cx("material-inspector")}>
      <InspectorHeading
        icon="shapes/cube-03"
        title={detail.name}
      />
      <dl className={cx("definition-list")}>
        <div>
          <dt>节点类型</dt>
          <dd>{detail.materialType ?? "未提供"}</dd>
        </div>
        <div>
          <dt>资源模板</dt>
          <dd>{node.resourceTemplate?.name ?? "未提供"}</dd>
        </div>
        <div>
          <dt>父节点</dt>
          <dd>{detail.parentMaterialUuid ?? "根节点"}</dd>
        </div>
        <div>
          <dt>库位数量</dt>
          <dd>{sites.length}</dd>
        </div>
      </dl>
      <SiteList
        sites={sites}
        onSelect={onSelect}
      />
    </aside>
  );
}

function collectNodeSites(
  node: MaterialGraphNode,
  nodes: readonly MaterialGraphNode[],
): SiteSummary[] {
  const related = new Set<string>([node.material.materialUuid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of nodes) {
      const parentId = candidate.material.parentMaterialUuid;
      if (parentId && related.has(parentId) && !related.has(candidate.material.materialUuid)) {
        related.add(candidate.material.materialUuid);
        changed = true;
      }
    }
  }
  const sites = new Map<string, SiteSummary>();
  for (const candidate of nodes) {
    if (!related.has(candidate.material.materialUuid)) continue;
    for (const site of candidate.sites) sites.set(site.siteUuid, site);
  }
  return [...sites.values()];
}

function SiteInspector({
  node,
  site,
  onSelect,
}: {
  node: MaterialGraphNode;
  site: SiteSummary;
  onSelect: (selection: MaterialSelection) => void;
}) {
  const occupied = site.occupancy.occupiedMaterialUuid;
  const status = site.occupancy.known
    ? occupied
      ? "available"
      : "empty"
    : "attention";
  return (
    <aside className={cx("material-inspector")}>
      <InspectorHeading
        icon="shapes/cube-03"
        title={site.name || site.key}
        iconColor={status === "available" ? "success" : status === "empty" ? "default" : "error"}
      />
      <StatusBadge
        status={status}
        label={
          site.occupancy.known
            ? occupied
              ? "已占用"
              : "空闲"
            : "占用未知"
        }
      />
      <dl className={cx("definition-list")}>
        <div>
          <dt>所属节点</dt>
          <dd>{node.material.name}</dd>
        </div>
        <div>
          <dt>库位标识</dt>
          <dd>
            <Tooltip title={site.siteUuid}>
              <span className={cx("definition-value-tooltip")}>{site.siteUuid}</span>
            </Tooltip>
          </dd>
        </div>
        <div>
          <dt>允许资源</dt>
          <dd>{site.allowedResourceTemplateUuids?.length ?? 0} 种</dd>
        </div>
        <div>
          <dt>当前物料</dt>
          <dd>{occupied ?? "空库位"}</dd>
        </div>
      </dl>
      {occupied && (
        <div className={cx("inspector-section")}>
          <Button
            type="default"
            className={cx("material-inspector__button")}
            onClick={() => onSelect({ kind: "material", materialId: occupied, siteId: site.siteUuid })}
          >
            查看占用物料
          </Button>
        </div>
      )}
    </aside>
  );
}

function MaterialDetailInspector({
  node,
  selectedSite,
  onSelect,
}: {
  node: MaterialGraphNode;
  selectedSite?: SiteSummary;
  onSelect: (selection: MaterialSelection) => void;
}) {
  const currentSite = node.currentSiteUuid
    ? (node.sites.find((item) => item.siteUuid === node.currentSiteUuid) ??
      node.sites[0])
    : node.sites[0];
  const site = selectedSite ?? currentSite;
  const detail = node.material;
  const status = !site
    ? "empty"
    : site.occupancy.known
      ? site.occupancy.occupiedMaterialUuid
        ? "available"
        : "empty"
      : "attention";
  return (
    <aside className={cx("material-inspector")}>
      <InspectorHeading
        icon="layout/layers-two-01"
        title={detail.name}
        iconColor={status === "available" ? "success" : status === "empty" ? "default" : "error"}
      />
      <StatusBadge
        status={status}
        label={
          !site
            ? "未绑定库位"
            : site.occupancy.known
              ? site.occupancy.occupiedMaterialUuid
                ? "已占用"
                : "空闲"
              : "占用未知"
        }
      />
      <dl className={cx("definition-list")}>
        <div>
          <dt>物料类型</dt>
          <dd>{detail.materialType ?? "未提供"}</dd>
        </div>
        <div>
          <dt>当前库位</dt>
          <dd>{site?.name ?? "未绑定库位"}</dd>
        </div>
        <div>
          <dt>父物料</dt>
          <dd>{detail.parentMaterialUuid ?? "根节点"}</dd>
        </div>
        <div>
          <dt>修订版本</dt>
          <dd>{detail.revision == null ? "未提供" : detail.revision}</dd>
        </div>
      </dl>
      <SiteList sites={node.sites} onSelect={onSelect} />
      <Typography.Text type="secondary" className={cx("capability-note")}>
        当前页面仅展示物料与库位状态；变更库位需通过统一物料命令执行。
      </Typography.Text>
    </aside>
  );
}

function SiteList({
  sites,
  onSelect,
}: {
  sites: readonly SiteSummary[];
  onSelect: (selection: MaterialSelection) => void;
}) {
  return (
    <div className={cx("inspector-section")}>
      <div className={cx("inspector-field-label")}>库位</div>
      <SitePicker
        sites={sites}
        variant="inspector"
        emptyDescription="没有库位信息"
        onSelectSite={(siteUuid) => onSelect({ kind: "site", siteId: siteUuid })}
      />
    </div>
  );
}

function MaterialManagement({
  graph,
  onBack,
}: {
  graph?: import("@unilab-fe/core").MaterialGraph;
  onBack: () => void;
}) {
  const [selected, setSelected] = useState<string | undefined>(
    graph?.nodes[0]?.material.materialUuid,
  );
  const [keyword, setKeyword] = useState("");
  const normalizedKeyword = keyword.trim().toLowerCase();
  const allNodes = graph?.nodes ?? [];
  const nodes = useMemo(
    () => filterMaterialNodes(allNodes, normalizedKeyword),
    [allNodes, normalizedKeyword],
  );
  const node =
    nodes.find((item) => item.material.materialUuid === selected) ?? nodes[0];
  const treeData = useMemo(() => buildTree(nodes), [nodes]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  useEffect(() => {
    setExpandedKeys(normalizedKeyword ? collectExpandableKeys(treeData) : []);
  }, [treeData, normalizedKeyword]);
  return (
    <div className={cx("page-stack material-management-page")}>
      <PageHeader
        leading={
          <Button
            type="text"
            className={cx("page-header-back")}
            aria-label="返回物料关系图"
            title="返回物料关系图"
            icon={<AppIcon name="arrows/arrow-left" size={18} />}
            onClick={onBack}
          />
        }
        title="物料管理"
      />
      <div className={cx("management-workspace")}>
        <section className={cx("management-tree")}>
          <Input
            allowClear
            prefix={<AppIcon name="general/search-md" size={16} />}
            placeholder="搜索物料"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Tree
            className={cx("resource-tree")}
            blockNode
            expandedKeys={expandedKeys}
            selectedKeys={selected ? [selected] : []}
            switcherIcon={({ expanded, isLeaf }) =>
              isLeaf ? null : (
                expanded
                  ? <ChevronDownIcon size={14} color="context" />
                  : <ChevronRightIcon size={14} color="context" />
              )
            }
            treeData={treeData}
            onExpand={(keys) => setExpandedKeys(keys.map(String))}
            onSelect={(keys) => setSelected(keys[0] as string)}
          />
        </section>
        {node ? (
          <LabMaterialInspector
            node={{ ...node, sites: collectNodeSites(node, allNodes) }}
            onSelectOccupiedMaterial={setSelected}
          />
        ) : (
          <Empty description="没有匹配的物料" />
        )}
      </div>
    </div>
  );
}

function buildTree(nodes: readonly MaterialGraphNode[]): TreeDataNode[] {
  const byParent = new Map<string | null, MaterialGraphNode[]>();
  nodes.forEach((node) => {
    const parent = node.material.parentMaterialUuid;
    byParent.set(parent, [...(byParent.get(parent) ?? []), node]);
  });
  const toTree = (parent: string | null): TreeDataNode[] =>
    (byParent.get(parent) ?? []).map((node) => ({
      key: node.material.materialUuid,
      title: node.material.name,
      children: toTree(node.material.materialUuid),
    }));
  return toTree(null);
}

function filterMaterialNodes(
  nodes: readonly MaterialGraphNode[],
  keyword: string,
): MaterialGraphNode[] {
  if (!keyword) return [...nodes];
  const byId = new Map(nodes.map((node) => [node.material.materialUuid, node]));
  const included = new Set<string>();
  for (const node of nodes) {
    const matches = `${node.material.name} ${node.material.barcode ?? ""}`
      .toLowerCase()
      .includes(keyword);
    if (!matches) continue;
    let current: MaterialGraphNode | undefined = node;
    const visited = new Set<string>();
    while (current && !visited.has(current.material.materialUuid)) {
      const id = current.material.materialUuid;
      visited.add(id);
      included.add(id);
      current = current.material.parentMaterialUuid
        ? byId.get(current.material.parentMaterialUuid)
        : undefined;
    }
  }
  return nodes.filter((node) => included.has(node.material.materialUuid));
}

function collectExpandableKeys(treeData: readonly TreeDataNode[]): string[] {
  return treeData.flatMap((node) => [
    ...(node.children?.length ? [String(node.key)] : []),
    ...collectExpandableKeys(node.children ?? []),
  ]);
}
