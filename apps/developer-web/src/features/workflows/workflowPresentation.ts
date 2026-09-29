import type {
  PublishedWorkflowRevision,
  PublishedWorkflowRevisionSummary,
} from "@unilab-fe/core";

export type WorkflowRecord = Readonly<Record<string, unknown>>;

export type WorkflowContractField = {
  readonly name: string;
  readonly required: boolean;
  readonly schema?: WorkflowRecord;
  readonly description?: string;
  readonly implicit?: boolean;
};

export type WorkflowNodeHandle = WorkflowContractField & {
  readonly ioType: "input" | "output";
  readonly value?: unknown;
};

export type WorkflowResourceKind =
  | "device"
  | "site"
  | "material"
  | "reagent"
  | "resource_template"
  | "resource";

export type WorkflowResourceDependency = {
  readonly kind: WorkflowResourceKind;
  readonly kindLabel: string;
  readonly value: string;
};

export type WorkflowResourceDirectory = {
  readonly resourceTemplates: readonly { uuid: string; displayName: string }[];
  readonly materials: readonly { uuid: string; name: string }[];
  readonly sites: readonly { uuid: string; name: string }[];
  readonly devices: readonly { deviceUuid: string; deviceKey: string; label: string }[];
};

export type WorkflowNodeDetails = {
  readonly inputs: readonly WorkflowNodeHandle[];
  readonly outputs: readonly WorkflowNodeHandle[];
  readonly resources: readonly WorkflowResourceDependency[];
};

export function resolveWorkflowResourceName(
  kind: WorkflowResourceKind,
  value: string,
  directory?: WorkflowResourceDirectory,
): string {
  if (!directory || !value) return value;
  const match =
    kind === "resource_template"
      ? directory.resourceTemplates.find((item) => item.uuid === value)?.displayName
      : kind === "site"
        ? directory.sites.find((item) => item.uuid === value)?.name ??
          directory.materials.find((item) => item.uuid === value)?.name
        : kind === "material"
          ? directory.materials.find((item) => item.uuid === value)?.name
          : kind === "device"
            ? directory.devices.find((item) => item.deviceUuid === value)?.label ??
              directory.devices.find((item) => item.deviceKey === value)?.label
            : undefined;
  return match || value;
}

function resolveAnyWorkflowResourceName(
  value: string,
  directory?: WorkflowResourceDirectory,
): string {
  if (!directory || !value) return value;
  return (
    directory.resourceTemplates.find((item) => item.uuid === value)?.displayName ??
    directory.materials.find((item) => item.uuid === value)?.name ??
    directory.sites.find((item) => item.uuid === value)?.name ??
    directory.devices.find((item) => item.deviceUuid === value)?.label ??
    directory.devices.find((item) => item.deviceKey === value)?.label ??
    value
  );
}

export function workflowValueText(
  value: unknown,
  directory?: WorkflowResourceDirectory,
): string {
  if (value == null) return "未填写";
  const record = asRecord(value);
  if (record?.uuid && typeof record.uuid === "string") {
    return resolveAnyWorkflowResourceName(record.uuid, directory);
  }
  if (typeof value === "string") return resolveAnyWorkflowResourceName(value, directory);
  return jsonText(value);
}

function asRecord(value: unknown): WorkflowRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as WorkflowRecord)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function schemaFromHandle(handle: WorkflowRecord): WorkflowRecord | undefined {
  const metadata = asRecord(handle.meta_data);
  const unilab = asRecord(metadata?.unilab);
  return (
    asRecord(unilab?.value_schema) ??
    asRecord(handle.schema) ??
    (typeof handle.type === "string" ? { type: handle.type } : undefined)
  );
}

function displayFieldName(value: WorkflowRecord, fallback: string): string {
  return readString(value, ["display_name", "name", "data_key", "handle_key"]) ?? fallback;
}

function requiredValue(value: unknown): boolean {
  return value === true;
}

function resourceKindForKey(key: string): {
  kind: WorkflowResourceKind;
  kindLabel: string;
} | null {
  const normalized = key.toLowerCase();
  if (normalized.includes("device")) return { kind: "device", kindLabel: "设备" };
  if (normalized === "site" || normalized.includes("warehouse") || normalized.includes("location")) {
    return { kind: "site", kindLabel: "库位" };
  }
  if (normalized.includes("reagent")) return { kind: "reagent", kindLabel: "试剂" };
  if (normalized === "material_uuid" || normalized === "material" || normalized.includes("material")) {
    return { kind: "material", kindLabel: "物料" };
  }
  if (normalized === "resource_template_uuid" || normalized.includes("resource_template")) {
    return { kind: "resource_template", kindLabel: "资源模板" };
  }
  if (normalized === "mount") return { kind: "material", kindLabel: "挂载物料" };
  return null;
}

function resourceValue(value: unknown): string {
  if (value == null || value === "") return "未指定";
  const record = asRecord(value);
  if (record?.uuid && typeof record.uuid === "string") return record.uuid;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return jsonText(value);
}

function pushResource(
  resources: WorkflowResourceDependency[],
  key: string,
  value: unknown,
): void {
  const kind = resourceKindForKey(key);
  if (!kind || value == null || value === "") return;
  const next = { ...kind, value: resourceValue(value) };
  if (!resources.some((item) => item.kind === next.kind && item.value === next.value)) {
    resources.push(next);
  }
}

function collectResourceFields(
  resources: WorkflowResourceDependency[],
  value: unknown,
): void {
  const record = asRecord(value);
  if (!record) return;
  Object.entries(record).forEach(([key, fieldValue]) => {
    if (resourceKindForKey(key)) pushResource(resources, key, fieldValue);
  });
}

export function workflowContracts(
  revision: PublishedWorkflowRevision,
): { inputs: readonly WorkflowContractField[]; outputs: readonly WorkflowContractField[] } {
  const metadata = asRecord(revision.graph.workflow.meta_data);
  const unilab = asRecord(metadata?.unilab);
  const inputContract = asRecord(unilab?.input_contract);
  const outputContract = asRecord(unilab?.output_contract);
  const decodedInputs = revision.graph.inputParameters ?? [];
  const inputs = decodedInputs.length ? decodedInputs.map((parameter) => ({
    name: parameter.title ?? parameter.name,
    required: parameter.required,
    schema: parameter.schema,
    description: parameter.description,
  })) : asArray(inputContract?.parameters).flatMap((value) => {
    const parameter = asRecord(value);
    if (!parameter) return [];
    return [{
      name: displayFieldName(parameter, "输入参数"),
      required: requiredValue(parameter.required),
      schema: asRecord(parameter.schema),
      description: readString(parameter, ["description"] ) ?? undefined,
    }];
  });
  const outputs = asArray(outputContract?.outputs).flatMap((value) => {
    const output = asRecord(value);
    if (!output) return [];
    return [{
      name: displayFieldName(output, "输出结果"),
      required: requiredValue(output.required),
      schema: asRecord(output.schema),
      description: readString(output, ["description"]) ?? undefined,
      implicit: output.implicit === true,
    }];
  });
  return { inputs, outputs };
}

export function workflowNodeDetails(
  revision: PublishedWorkflowRevision,
  node: WorkflowRecord,
): WorkflowNodeDetails {
  const templateId = readString(node, ["workflow_node_template_uuid"]);
  const handles = revision.graph.handleTemplates.filter(
    (handle) => readString(handle, ["workflow_node_template_uuid"]) === templateId,
  );
  const params = asRecord(node.param) ?? {};
  const toHandle = (handle: WorkflowRecord, index: number): WorkflowNodeHandle => {
    const dataKey = readString(handle, ["data_key", "handle_key"]);
    const value = dataKey ? params[dataKey] : undefined;
    return {
      name: displayFieldName(handle, `参数 ${index + 1}`),
      required: requiredValue(handle.required),
      schema: schemaFromHandle(handle),
      description: readString(handle, ["description"]) ?? undefined,
      ioType: handle.io_type === "source" ? "output" : "input",
      ...(value === undefined ? {} : { value }),
    };
  };
  const inputs: WorkflowNodeHandle[] = [];
  const outputs: WorkflowNodeHandle[] = [];
  handles.forEach((handle, index) => {
    const item = toHandle(handle, index);
    if (item.ioType === "output") outputs.push(item);
    else inputs.push(item);
  });
  const metadata = asRecord(node.meta_data);
  const unilab = asRecord(metadata?.unilab);
  const executorBinding = asRecord(unilab?.executor_binding);
  const resources: WorkflowResourceDependency[] = [];
  if (executorBinding?.device_id !== undefined) {
    pushResource(resources, "device_id", executorBinding.device_id);
  }
  Object.entries(params).forEach(([name, value]) => {
    if (resourceKindForKey(name)) pushResource(resources, name, value);
    collectResourceFields(resources, value);
  });
  revision.graph.inventoryRequirements
    .filter((requirement) => requirement.consumeNodeUuid === readString(node, ["uuid", "node_uuid"]))
    .forEach((requirement) => {
      const kind: WorkflowResourceKind =
        requirement.targetType === "reagent"
          ? "reagent"
          : requirement.targetType === "current_substance"
            ? "material"
            : "resource";
      resources.push({
        kind,
        kindLabel:
          kind === "reagent"
            ? "试剂"
            : kind === "material"
              ? "当前物料"
              : requirement.targetType,
        value: `${requirement.requirementKey} · ${requirement.requiredQuantity} ${requirement.quantityUnit}`,
      });
    });
  return { inputs, outputs, resources };
}

export function readString(
  value: WorkflowRecord | undefined,
  keys: readonly string[],
): string | null {
  if (!value) return null;
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key])
      return value[key] as string;
  }
  return null;
}

export function workflowTypeLabel(
  type: PublishedWorkflowRevisionSummary["workflowType"],
): string {
  return type === "experiment_operation" ? "实验操作" : "工作流";
}

export function workflowStatusLabel(
  status: PublishedWorkflowRevisionSummary["status"],
): string {
  if (status === "published") return "已发布";
  if (status === "source") return "未发布";
  return status;
}

export function nodeLabel(node: WorkflowRecord, index: number): string {
  return (
    readString(node, ["name", "label", "title", "display_name", "node_name"]) ??
    `节点 ${index + 1}`
  );
}

export function nodeUuid(node: WorkflowRecord, index: number): string {
  return readString(node, ["uuid", "node_uuid", "id"]) ?? `node-${index}`;
}

export function jsonText(value: unknown): string {
  if (value == null) return "暂无后端数据";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function workflowCounts(revision: PublishedWorkflowRevision) {
  return {
    nodes: revision.graph.nodes.length,
    edges: revision.graph.edges.length,
    requirements: revision.graph.inventoryRequirements.length,
  };
}
