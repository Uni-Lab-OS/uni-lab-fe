import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import {
  createServer as createHttpServer,
  request as requestHttp,
  type Server as HttpServer
} from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'

export const AUTHORING_WORKFLOW_UUID =
  '10000000-0000-4000-8000-000000000001'
export const SECOND_AUTHORING_WORKFLOW_UUID =
  '10000000-0000-4000-8000-000000000002'
export const RUNTIME_AUTHORING_WORKFLOW_UUID =
  '10000000-0000-4000-8000-000000000003'
export const SCALAR_INPUT_WORKFLOW_UUID =
  '10000000-0000-4000-8000-000000000004'
export const RESOURCE_SLOT_INPUT_WORKFLOW_UUID =
  '10000000-0000-4000-8000-000000000005'
export const RESOURCE_SLOT_MATERIAL_UUID =
  '11000000-0000-4000-8000-000000000005'
export const COMPOSITE_CHILD_WORKFLOW_UUID =
  '10000000-0000-4000-8000-000000000006'
export const COMPOSITE_PARENT_WORKFLOW_UUID =
  '10000000-0000-4000-8000-000000000007'
export const COMPOSITE_INVOCATION_UUID =
  '20000000-0000-4000-8000-000000000062'

export interface PersistentAuthoringOs {
  url: string
  upstreamUrl: string
  workflowUuid: string
  secondWorkflowUuid: string
  runtimeWorkflowUuid: string
  scalarInputWorkflowUuid: string
  resourceSlotInputWorkflowUuid: string
  resourceSlotMaterialUuid: string
  compositeChildWorkflowUuid: string
  compositeParentWorkflowUuid: string
  compositeInvocationUuid: string
  sourcePath: string
  secondSourcePath: string
  logs: () => string
  failNextRequest: (request: {
    method: string
    path: string
    status?: number
    code?: string
    message?: string
    retryable?: boolean
  }) => void
  startRuntimeJob: (taskUuid: string, jobUuid: string) => Promise<void>
  commitJobFeedback: (
    jobUuid: string,
    samples: readonly RuntimeFeedbackSample[]
  ) => Promise<void>
  createTerminalCommandRace: (
    taskUuid: string,
    idempotencyKey: string
  ) => Promise<RuntimeCommandMutationResult>
  mutateResourceSlotMaterialAuthority: (
    state: MaterialAuthorityRaceState
  ) => Promise<void>
  stopProcess: () => Promise<void>
  restart: () => Promise<void>
  stop: () => Promise<void>
}

export interface RuntimeFeedbackSample {
  sequence: number
  feedback_type: string
  data: Record<string, unknown>
  observed_at: string
  idempotency_key: string
}

export interface RuntimeCommandMutationResult {
  uuid: string
  status: string
  result: Record<string, unknown>
  [key: string]: unknown
}

export type MaterialAuthorityRaceState =
  | 'invalid_input'
  | 'not_found'
  | 'conflict'
  | 'restore'

export interface PersistentAuthoringOsOptions {
  faultProxy?: boolean
  compositeFixture?: boolean
}

export async function startPersistentAuthoringOs(
  options: PersistentAuthoringOsOptions = {}
): Promise<PersistentAuthoringOs> {
  const osRepository = resolve(
    process.env.UNILAB_AUTHORING_OS_ROOT ||
      '/home/changjunhan/Uni-Lab-Core/.worktrees/uni-lab-os-runtime-integration'
  )
  const python =
    process.env.UNILAB_OS_PYTHON ||
    '/home/changjunhan/.micromamba/envs/unilab/bin/python'
  const directory = mkdtempSync(join(tmpdir(), 'unilab-authoring-os-'))
  const workingDirectory = join(directory, 'unilabos_data')
  const editableRoot = join(directory, 'editable')
  const sourcePath = join(
    editableRoot,
    'production_lab',
    'workflows',
    'demo.py'
  )
  const secondSourcePath = join(
    editableRoot,
    'production_lab',
    'workflows',
    'second.py'
  )
  const port = await availablePort()
  const upstreamUrl = `http://127.0.0.1:${port}`
  let child: ChildProcess | null = null
  let output = ''

  const launch = async (): Promise<void> => {
    child = spawn(
      python,
      [
        '-c',
        PYTHON_LAUNCHER,
        workingDirectory,
        editableRoot,
        String(port),
        options.compositeFixture ? '1' : '0'
      ],
      {
        cwd: osRepository,
        env: {
          ...process.env,
          PYTHONPATH: osRepository,
          PYTHONUNBUFFERED: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    const launched = child
    launched.stdout?.on('data', (chunk) => {
      output += chunk.toString()
    })
    launched.stderr?.on('data', (chunk) => {
      output += chunk.toString()
    })
    await waitUntilReady(upstreamUrl, launched, () => output)
  }

  try {
    await launch()
  } catch (error) {
    if (child) await stopChild(child)
    removeFixtureDirectory(directory)
    throw error
  }

  // 旧确定性 OS 夹具仍发布页码形态的节点模板目录。所有浏览器用例都经此
  // 合同代理消费当前 UUID 游标形态，避免迫使正式前端兼容已移除的旧协议。
  const contractProxy = await startFaultProxy(upstreamUrl)
  const mutateRuntime = (payload: Record<string, unknown>): Promise<void> =>
    runRuntimeMutation({
      python,
      osRepository,
      workingDirectory,
      payload
    })
  const mutateResourceSlotMaterialAuthority = (
    state: MaterialAuthorityRaceState
  ): Promise<void> => runMaterialAuthorityMutation({
    python,
    osRepository,
    workingDirectory,
    materialUuid: RESOURCE_SLOT_MATERIAL_UUID,
    state
  })

  return {
    url: contractProxy.url,
    upstreamUrl,
    workflowUuid: AUTHORING_WORKFLOW_UUID,
    secondWorkflowUuid: SECOND_AUTHORING_WORKFLOW_UUID,
    runtimeWorkflowUuid: RUNTIME_AUTHORING_WORKFLOW_UUID,
    scalarInputWorkflowUuid: SCALAR_INPUT_WORKFLOW_UUID,
    resourceSlotInputWorkflowUuid: RESOURCE_SLOT_INPUT_WORKFLOW_UUID,
    resourceSlotMaterialUuid: RESOURCE_SLOT_MATERIAL_UUID,
    compositeChildWorkflowUuid: COMPOSITE_CHILD_WORKFLOW_UUID,
    compositeParentWorkflowUuid: COMPOSITE_PARENT_WORKFLOW_UUID,
    compositeInvocationUuid: COMPOSITE_INVOCATION_UUID,
    sourcePath,
    secondSourcePath,
    logs: () => output,
    failNextRequest: (request) => {
      if (!options.faultProxy) {
        throw new Error('PersistentAuthoringOs fault proxy is not enabled')
      }
      contractProxy.failNext(request)
    },
    startRuntimeJob: async (taskUuid, jobUuid) => {
      await mutateRuntime({
        action: 'start_job',
        task_uuid: taskUuid,
        job_uuid: jobUuid
      })
    },
    commitJobFeedback: async (jobUuid, samples) => {
      await mutateRuntime({
        action: 'commit_feedback',
        job_uuid: jobUuid,
        samples
      })
    },
    createTerminalCommandRace: async (taskUuid, idempotencyKey) => {
      const result = await mutateRuntime({
        action: 'terminal_command_race',
        task_uuid: taskUuid,
        idempotency_key: idempotencyKey
      })
      if (!result) throw new Error('Terminal command race returned no result')
      return result as RuntimeCommandMutationResult
    },
    mutateResourceSlotMaterialAuthority,
    stopProcess: async () => {
      if (!child) return
      await stopChild(child)
      child = null
    },
    restart: async () => {
      if (child) await stopChild(child)
      child = null
      await launch()
    },
    stop: async () => {
      await contractProxy.stop()
      if (child) await stopChild(child)
      child = null
      removeFixtureDirectory(directory)
    }
  }
}

const PYTHON_LAUNCHER = String.raw`
import sys
from pathlib import Path

from tests.workflow.test_authoring_engine import (
    ANALYZE_NODE_UUID,
    PREPARE_NODE_UUID,
    RESOURCE_TEMPLATE_UUID,
    WORKFLOW_UUID,
    _catalog_imports,
    _source,
)
from unilabos.config.config import BasicConfig
from unilabos.workflow.catalog import CatalogAuthority, TemplateCatalog
from unilabos.workflow.service import WorkflowService
from unilabos.workflow.store import WorkflowStore

working_dir = Path(sys.argv[1])
editable_root = Path(sys.argv[2])
port = int(sys.argv[3])
composite_fixture = sys.argv[4] == "1"
package_root = editable_root / "production_lab"
source_path = package_root / "workflows" / "demo.py"
second_workflow_uuid = "${SECOND_AUTHORING_WORKFLOW_UUID}"
second_source_path = package_root / "workflows" / "second.py"
runtime_workflow_uuid = "${RUNTIME_AUTHORING_WORKFLOW_UUID}"
runtime_source_path = package_root / "workflows" / "runtime.py"
scalar_input_workflow_uuid = "${SCALAR_INPUT_WORKFLOW_UUID}"
scalar_input_source_path = package_root / "workflows" / "scalar_input.py"
resource_slot_input_workflow_uuid = "${RESOURCE_SLOT_INPUT_WORKFLOW_UUID}"
resource_slot_input_source_path = package_root / "workflows" / "resource_slot_input.py"
resource_slot_material_uuid = "${RESOURCE_SLOT_MATERIAL_UUID}"
composite_child_workflow_uuid = "${COMPOSITE_CHILD_WORKFLOW_UUID}"
composite_parent_workflow_uuid = "${COMPOSITE_PARENT_WORKFLOW_UUID}"
composite_invocation_uuid = "${COMPOSITE_INVOCATION_UUID}"
composite_child_source_path = package_root / "workflows" / "composite_child.py"
composite_parent_source_path = package_root / "workflows" / "composite_parent.py"

def fixture_catalog_imports():
    """发布动作模板与唯一的物料来源（MaterialSource）框架模板。"""
    from unilabos.workflow.catalog import NodeTemplateImport
    imports = tuple(_catalog_imports()) + (
        NodeTemplateImport(
            template={
                "uuid": "20000000-0000-4000-8000-000000000090",
                "description": "E2E framework-owned MaterialSource",
                "meta_data": {"framework": "material_source"},
                "resource_template_uuid": RESOURCE_TEMPLATE_UUID,
                "name": "material_source",
                "display_name": "物料来源",
                "class": "unilabos.workflow.authoring:material_source",
                "goal": {},
                "goal_default": {},
                "feedback": {},
                "result": {},
                "schema": None,
                "type": "material_source",
                "icon": None,
                "header": None,
                "footer": None,
                "node_type": "material_source",
            },
            handles=(
                {
                    "uuid": "30000000-0000-4000-8000-000000000090",
                    "description": "测试夹具解析出的物料",
                    "meta_data": {"framework": "material_source"},
                    "handle_key": "material",
                    "io_type": "source",
                    "display_name": "物料",
                    "type": "ResourceSlot",
                    "required": False,
                    "data_source": "executor",
                    "data_key": "material",
                },
            ),
        ),
    )
    if not composite_fixture:
        return imports
    from unilabos.workflow.handle_projection import structural_ready_handle
    return tuple(
        NodeTemplateImport(
            template=dict(item.template),
            handles=tuple(
                structural_ready_handle(str(handle["io_type"]))
                if handle.get("handle_key") == "ready"
                else dict(handle)
                for handle in item.handles
            ),
        )
        for item in imports
    )

source_path.parent.mkdir(parents=True, exist_ok=True)
source_path.write_text(_source(), encoding="utf-8")
second_source = _source(workflow_uuid=second_workflow_uuid)
second_source = second_source.replace(
    PREPARE_NODE_UUID,
    "20000000-0000-4000-8000-000000000011",
).replace(
    ANALYZE_NODE_UUID,
    "20000000-0000-4000-8000-000000000012",
)
second_source_path.write_text(second_source, encoding="utf-8")
runtime_source_path.write_text(
    f'''from lab.devices import Reactor
from unilabos.workflow.authoring import device, workflow_definition, workflow_output


reactor: Reactor = device()


@workflow_definition(
    workflow_uuid="{runtime_workflow_uuid}",
    displayname="Runtime control demo",
    description="Two catalog-backed nodes without external input.",
)
def runtime_control_demo():
    # unilab:node_uuid=20000000-0000-4000-8000-000000000021
    prepared = reactor.finalize(report="prepared")
    # unilab:node_uuid=20000000-0000-4000-8000-000000000022
    analyzed = reactor.finalize(report=prepared.report)
    return workflow_output(report=analyzed.report)
''',
    encoding="utf-8",
)
scalar_input_source_path.write_text(
    f'''from lab.devices import Reactor
from unilabos.registry.annotations import JSONValue
from unilabos.workflow.authoring import device, workflow_definition, workflow_output


reactor: Reactor = device()


@workflow_definition(
    workflow_uuid="{scalar_input_workflow_uuid}",
    displayname="Scalar input Task form",
    description="I1 real-OS scalar input/default gate.",
)
def scalar_input_task(
    *,
    label: str,
    count: int,
    enabled: bool,
    tags: list[str],
    config: dict[str, JSONValue],
    note: str | None = None,
    attempts: int = 3,
):
    # unilab:node_uuid=20000000-0000-4000-8000-000000000031
    completed = reactor.finalize(report=label)
    return workflow_output(report=completed.report)
''',
    encoding="utf-8",
)
resource_slot_input_source_path.write_text(
    f'''from unilabos.registry.placeholder_type import ResourceSlot
from unilabos.workflow.authoring import workflow_definition, workflow_output


@workflow_definition(
    workflow_uuid="{resource_slot_input_workflow_uuid}",
    displayname="ResourceSlot input Task form",
    description="I1 real-OS ResourceSlot input and Material resolution gate.",
)
def resource_slot_input_task(*, sample: ResourceSlot):
    return workflow_output(sample=sample)
''',
    encoding="utf-8",
)
if composite_fixture:
    composite_child_source_path.write_text(
        f'''from c1_lifecycle.device import MeasurementDevice
from unilabos.workflow.authoring import device, workflow_definition, workflow_output


measurement_device: MeasurementDevice = device()


@workflow_definition(
    workflow_uuid="{composite_child_workflow_uuid}",
    displayname="C1 Published child",
    description="PackageCatalog-backed child with one internal action.",
)
def published_child(*, value: float):
    # unilab:node_uuid=20000000-0000-4000-8000-000000000061
    completed = measurement_device.measure(value=value)
    return workflow_output(result=completed.result)
''',
        encoding="utf-8",
    )
    composite_parent_source_path.write_text(
        f'''from c1_lifecycle.device import MeasurementDevice
from production_lab.workflows.composite_child import published_child
from unilabos.workflow.authoring import device, workflow_definition, workflow_output


measurement_device: MeasurementDevice = device()


@workflow_definition(
    workflow_uuid="{composite_parent_workflow_uuid}",
    displayname="C1 Composite parent",
    description="Real PackageCatalog Composite browser gate.",
)
def composite_parent():
    # unilab:node_uuid=20000000-0000-4000-8000-000000000063
    prepared = measurement_device.measure(value=1)
    # unilab:node_uuid={composite_invocation_uuid}
    child = published_child(value=prepared.result)
    # unilab:node_uuid=20000000-0000-4000-8000-000000000064
    finalized = measurement_device.measure(value=child.result)
    return workflow_output(report=finalized.result)
''',
        encoding="utf-8",
    )
editable_root.mkdir(parents=True, exist_ok=True)
(editable_root / "package.yaml").write_text(
    "\n".join([
        "package:",
        "  name: production_lab",
        "",
        "workflows:",
        f"  - workflow_uuid: {WORKFLOW_UUID}",
        "    source: production_lab/workflows/demo.py",
        f"  - workflow_uuid: {second_workflow_uuid}",
        "    source: production_lab/workflows/second.py",
        f"  - workflow_uuid: {runtime_workflow_uuid}",
        "    source: production_lab/workflows/runtime.py",
        f"  - workflow_uuid: {scalar_input_workflow_uuid}",
        "    source: production_lab/workflows/scalar_input.py",
        f"  - workflow_uuid: {resource_slot_input_workflow_uuid}",
        "    source: production_lab/workflows/resource_slot_input.py",
        *([
            f"  - workflow_uuid: {composite_child_workflow_uuid}",
            "    source: production_lab/workflows/composite_child.py",
            f"  - workflow_uuid: {composite_parent_workflow_uuid}",
            "    source: production_lab/workflows/composite_parent.py",
        ] if composite_fixture else []),
        "",
    ]),
    encoding="utf-8",
)
working_dir.mkdir(parents=True, exist_ok=True)
authority = CatalogAuthority(authority_id="fe-d117-e2e-local", kind="local")
database_path = working_dir / "workflow.db"
initialize_store = not database_path.exists()
store = WorkflowStore(database_path)
try:
    if initialize_store:
        service = WorkflowService(store)
        service.create_workflow(
            name="FE D117 real OS fixture",
            tags=[],
            description="Real persistent Authoring E2E",
            meta_data={},
            workflow_uuid=WORKFLOW_UUID,
        )
        service.create_workflow(
            name="FE D117 second Workflow fixture",
            tags=[],
            description="Independent persistent Authoring session",
            meta_data={},
            workflow_uuid=second_workflow_uuid,
        )
        service.create_workflow(
            name="UI1B Runtime control fixture",
            tags=[],
            description="Real Task/Job Runtime E2E",
            meta_data={},
            workflow_uuid=runtime_workflow_uuid,
        )
        service.create_workflow(
            name="I1 scalar input Task form fixture",
            tags=[],
            description="Real OS scalar Task input/default E2E",
            meta_data={},
            workflow_uuid=scalar_input_workflow_uuid,
        )
        service.create_workflow(
            name="I1 ResourceSlot input Task form fixture",
            tags=[],
            description="Real OS ResourceSlot Task input E2E",
            meta_data={},
            workflow_uuid=resource_slot_input_workflow_uuid,
        )
        if composite_fixture:
            service.create_workflow(
                name="C1 Published child fixture",
                tags=[],
                description="PackageCatalog-backed Composite child",
                meta_data={},
                workflow_uuid=composite_child_workflow_uuid,
            )
            service.create_workflow(
                name="C1 Composite parent fixture",
                tags=[],
                description="Persistent Composite Authoring E2E",
                meta_data={},
                workflow_uuid=composite_parent_workflow_uuid,
            )
        imports = fixture_catalog_imports()
        for item in imports:
            item.template.pop("uuid", None)
            for handle in item.handles:
                handle.pop("uuid", None)
        TemplateCatalog(store).replace(authority, imports)
finally:
    store.close()

runtime_catalog_options = {}
if composite_fixture:
    from unilabos.package_manager import (
        DefinitionCatalog,
        DefinitionRecord,
        DistributionIdentity,
        PackageCatalog,
    )
    from tests.workflow.test_c1_catalog_publication_lifecycle import (
        _registry_snapshot,
    )

    package_catalog = PackageCatalog.create(
        distribution=DistributionIdentity(
            name="production-lab",
            normalized_name="production-lab",
            version="1.0.0",
            requires_python=">=3.11",
        ),
        import_package="production_lab",
        namespace="e2e.production_lab",
        definitions=DefinitionCatalog(
            workflows=(
                DefinitionRecord(
                    kind="workflow",
                    id="published_child",
                    fqid="production_lab.workflows.published_child",
                    module="production_lab.workflows.composite_child",
                    symbol="published_child",
                    declaring_file="production_lab/workflows/composite_child.py",
                    content_hash="sha256:" + "6" * 64,
                    displayname="C1 Published child",
                    description="C1 real OS child fixture",
                    details={
                        "workflow_uuid": composite_child_workflow_uuid,
                        "source_uri": (
                            "package://production_lab/workflows/composite_child.py"
                        ),
                    },
                ),
            )
        ),
        content_digest="sha256:" + "8" * 64,
    )
    registry_snapshot = _registry_snapshot(include_host=True)
    runtime_catalog_options = {
        "registry_snapshot": registry_snapshot,
        "resource_registry_snapshot": {},
        "workflow_package_catalogs": (package_catalog,),
    }

if initialize_store:
    from unilabos.app.scheduler.inventory import (
        InventoryService,
        ResourceTemplateIdentity,
    )

    seed_inventory = InventoryService.open(
        working_dir=working_dir,
        resource_templates={
            RESOURCE_TEMPLATE_UUID: ResourceTemplateIdentity(
                uuid=RESOURCE_TEMPLATE_UUID,
                material_class="lab.resources:plate_96",
            ),
        },
    )
    try:
        seed_inventory.create_material(
            material_uuid=resource_slot_material_uuid,
            resource_template_uuid=RESOURCE_TEMPLATE_UUID,
            barcode="I1-RESOURCE-SLOT-005",
            name="I1 ResourceSlot sample",
        )
    finally:
        seed_inventory.close()

BasicConfig.working_dir = str(working_dir)
BasicConfig.workflow_graph_authority = authority
BasicConfig.workflow_editable_package_roots = (editable_root,)

from unilabos.app.scheduler.integration import setup_edge_scheduler
from unilabos.workflow.composition import (
    compose_workflow_runtime,
    get_workflow_inventory_service,
)

workflow_service = compose_workflow_runtime(
    BasicConfig.working_dir,
    authority=authority,
    editable_package_roots=BasicConfig.workflow_editable_package_roots,
    **runtime_catalog_options,
)
if composite_fixture:
    def apply_fixture(workflow_uuid, source_path):
        before = workflow_service.get_authoring(workflow_uuid)
        aggregate = workflow_service.save_draft(
            workflow_uuid,
            python_source=source_path.read_text(encoding="utf-8"),
            expected_draft_hash=before["draft"]["draft_hash"],
            expected_workflow_revision=before["workflow_revision"],
        )
        candidate = aggregate["candidate"]
        if candidate is None and aggregate["state"] == "applied":
            return
        if candidate is None:
            raise RuntimeError(aggregate)
        normalized_source = candidate["normalized_python_source"]
        if aggregate["draft"]["python_source"] != normalized_source:
            aggregate = workflow_service.save_draft(
                workflow_uuid,
                python_source=normalized_source,
                expected_draft_hash=aggregate["draft"]["draft_hash"],
                expected_workflow_revision=aggregate["workflow_revision"],
            )
            candidate = aggregate["candidate"]
            if candidate is None:
                raise RuntimeError(aggregate)
        workflow_service.apply_authoring(
            workflow_uuid,
            candidate_hash=candidate["candidate_hash"],
        )
        source_path.write_text(normalized_source, encoding="utf-8")

    apply_fixture(composite_child_workflow_uuid, composite_child_source_path)
    apply_fixture(composite_parent_workflow_uuid, composite_parent_source_path)

inventory_service = get_workflow_inventory_service()
if inventory_service is None:
    raise RuntimeError("Workflow composition did not expose InventoryService")
setup_edge_scheduler(
    inventory_service=inventory_service,
    workflow_tasks=workflow_service,
    device_state_db_path="off",
    workflow_history_db_path="off",
)

from unilabos.app.web.server import start_server
start_server(
    host="127.0.0.1",
    port=port,
    open_browser=False,
    **runtime_catalog_options,
)
`

const PYTHON_RUNTIME_MUTATOR = String.raw`
import json
import sys
from pathlib import Path

from unilabos.workflow.runtime import WorkflowRuntimeCoordinator
from unilabos.workflow.service import WorkflowService
from unilabos.workflow.store import WorkflowStore

working_dir = Path(sys.argv[1])
payload = json.loads(sys.argv[2])
store = WorkflowStore(working_dir / "workflow.db")
try:
    coordinator = WorkflowRuntimeCoordinator(store)
    result = None
    if payload["action"] == "start_job":
        coordinator.start_task(payload["task_uuid"])
        coordinator.transition_job(payload["job_uuid"], "dispatched")
        coordinator.transition_job(payload["job_uuid"], "running")
    elif payload["action"] == "commit_feedback":
        coordinator.commit_job_feedback(payload["job_uuid"], payload["samples"])
    elif payload["action"] == "terminal_command_race":
        service = WorkflowService(store)
        service.create_workflow_task_command(
            payload["task_uuid"],
            command_type="cancel",
            target_node_uuid=None,
            idempotency_key=payload["idempotency_key"],
            description="UI1D deterministic terminal race",
            meta_data={"source": "ui1d-final-gate"},
        )
        coordinator.transition_task(payload["task_uuid"], "canceled")
        result = coordinator.consume_next_command(payload["task_uuid"])
    else:
        raise RuntimeError(f"unknown runtime mutation: {payload['action']}")
    if result is not None:
        print("UNILAB_RUNTIME_RESULT=" + json.dumps(result, sort_keys=True))
finally:
    store.close()
`

const PYTHON_MATERIAL_AUTHORITY_MUTATOR = String.raw`
import sqlite3
import sys
from pathlib import Path

working_dir = Path(sys.argv[1])
material_uuid = sys.argv[2]
state = sys.argv[3]
database_path = working_dir / "inventory.db"
if not database_path.is_file():
    raise RuntimeError(f"independent Material authority is missing: {database_path}")

connection = sqlite3.connect(database_path, timeout=10)
try:
    connection.create_collation(
        "UNICODE_CASEFOLD",
        lambda left, right: (left.casefold() > right.casefold())
        - (left.casefold() < right.casefold()),
    )
    connection.execute("PRAGMA foreign_keys = ON")
    if state == "invalid_input":
        connection.execute(
            "UPDATE material SET material_kind = 'device', disposition = NULL "
            "WHERE uuid = ?",
            (material_uuid,),
        )
    elif state == "not_found":
        connection.execute(
            "UPDATE material SET deleted_at = '2099-01-01T00:00:00Z' "
            "WHERE uuid = ?",
            (material_uuid,),
        )
    elif state == "conflict":
        connection.execute(
            "UPDATE material SET material_kind = 'business', "
            "disposition = 'quarantined' WHERE uuid = ?",
            (material_uuid,),
        )
    elif state == "restore":
        connection.execute(
            "UPDATE material SET material_kind = 'business', "
            "disposition = 'active', deleted_at = NULL WHERE uuid = ?",
            (material_uuid,),
        )
    else:
        raise RuntimeError(f"unknown Material authority race: {state}")
    if connection.execute(
        "SELECT changes()"
    ).fetchone()[0] != 1:
        raise RuntimeError(f"Material authority race target is missing: {material_uuid}")
    connection.commit()
finally:
    connection.close()
`

async function runRuntimeMutation({
  python,
  osRepository,
  workingDirectory,
  payload
}: {
  python: string
  osRepository: string
  workingDirectory: string
  payload: Record<string, unknown>
}): Promise<Record<string, unknown> | null> {
  return new Promise<Record<string, unknown> | null>((resolveMutation, rejectMutation) => {
    const mutation = spawn(
      python,
      ['-c', PYTHON_RUNTIME_MUTATOR, workingDirectory, JSON.stringify(payload)],
      {
        cwd: osRepository,
        env: {
          ...process.env,
          PYTHONPATH: osRepository,
          PYTHONUNBUFFERED: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let output = ''
    mutation.stdout?.on('data', (chunk) => {
      output += chunk.toString()
    })
    mutation.stderr?.on('data', (chunk) => {
      output += chunk.toString()
    })
    mutation.once('error', rejectMutation)
    mutation.once('exit', (code) => {
      if (code !== 0) {
        rejectMutation(new Error(
          `WorkflowRuntimeCoordinator fixture exited with ${code}\n${output}`
        ))
        return
      }
      const resultLine = output.split(/\r?\n/).find((line) =>
        line.startsWith('UNILAB_RUNTIME_RESULT=')
      )
      resolveMutation(resultLine
        ? JSON.parse(resultLine.slice('UNILAB_RUNTIME_RESULT='.length)) as Record<string, unknown>
        : null)
    })
  })
}

async function runMaterialAuthorityMutation({
  python,
  osRepository,
  workingDirectory,
  materialUuid,
  state
}: {
  python: string
  osRepository: string
  workingDirectory: string
  materialUuid: string
  state: MaterialAuthorityRaceState
}): Promise<void> {
  await new Promise<void>((resolveMutation, rejectMutation) => {
    const mutation = spawn(
      python,
      [
        '-c',
        PYTHON_MATERIAL_AUTHORITY_MUTATOR,
        workingDirectory,
        materialUuid,
        state
      ],
      {
        cwd: osRepository,
        env: {
          ...process.env,
          PYTHONPATH: osRepository,
          PYTHONUNBUFFERED: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    let output = ''
    mutation.stdout?.on('data', (chunk) => {
      output += chunk.toString()
    })
    mutation.stderr?.on('data', (chunk) => {
      output += chunk.toString()
    })
    mutation.once('error', rejectMutation)
    mutation.once('exit', (code) => {
      if (code === 0) {
        resolveMutation()
        return
      }
      rejectMutation(new Error(
        `Material authority race fixture exited with ${code}\n${output}`
      ))
    })
  })
}

interface FaultProxy {
  url: string
  failNext: (request: {
    method: string
    path: string
    status?: number
    code?: string
    message?: string
    retryable?: boolean
  }) => void
  stop: () => Promise<void>
}

async function startFaultProxy(upstreamUrl: string): Promise<FaultProxy> {
  const rules: Array<{
    method: string
    path: string
    status: number
    code?: string
    message?: string
    retryable?: boolean
  }> = []
  const port = await availablePort()
  const server: HttpServer = createHttpServer((incoming, outgoing) => {
    const incomingUrl = new URL(incoming.url || '/', upstreamUrl)
    const method = incoming.method || 'GET'
    const fixtureCatalog = currentFixtureCatalogResponse(method, incomingUrl)
    if (fixtureCatalog) {
      incoming.resume()
      outgoing.writeHead(200, {
        'Access-Control-Allow-Origin': incoming.headers.origin || '*',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(fixtureCatalog)
      })
      outgoing.end(fixtureCatalog)
      return
    }
    const faultIndex = rules.findIndex((rule) =>
      rule.method === method && rule.path === incomingUrl.pathname
    )
    if (faultIndex >= 0) {
      const [fault] = rules.splice(faultIndex, 1)
      incoming.resume()
      const body = JSON.stringify({
        error: {
          code: fault?.code ?? 'ui1c_fault_injected',
          message: fault?.message ??
            `UI1C fault boundary rejected ${method} ${incomingUrl.pathname}`,
          retryable: fault?.retryable ?? true
        }
      })
      outgoing.writeHead(fault?.status ?? 503, {
        'Access-Control-Allow-Origin': incoming.headers.origin || '*',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      })
      outgoing.end(body)
      return
    }

    const headers = { ...incoming.headers, host: incomingUrl.host }
    const upstream = requestHttp(incomingUrl, { method, headers }, (response) => {
      const abortOutgoing = (error?: Error): void => {
        if (!outgoing.destroyed) outgoing.destroy(error)
      }
      response.once('aborted', () => abortOutgoing())
      response.once('error', abortOutgoing)
      if (
        method === 'GET' &&
        incomingUrl.pathname === '/api/v1/workflow-node-templates'
      ) {
        const chunks: Buffer[] = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          const body = normalizeWorkflowNodeTemplateCatalog(
            Buffer.concat(chunks)
          )
          const responseHeaders = {
            ...response.headers,
            'content-length': String(body.length)
          }
          delete responseHeaders['transfer-encoding']
          outgoing.writeHead(response.statusCode || 502, responseHeaders)
          outgoing.end(body)
        })
        return
      }
      outgoing.writeHead(response.statusCode || 502, response.headers)
      response.pipe(outgoing)
    })
    upstream.on('error', (error) => {
      if (outgoing.headersSent) {
        outgoing.destroy(error)
        return
      }
      const body = JSON.stringify({
        error: {
          code: 'ui1c_upstream_unavailable',
          message: 'UI1C OS boundary is temporarily unavailable',
          retryable: true
        }
      })
      outgoing.writeHead(502, {
        'Access-Control-Allow-Origin': incoming.headers.origin || '*',
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body)
      })
      outgoing.end(body)
    })
    incoming.pipe(upstream)
  })
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, '127.0.0.1', () => resolveListen())
  })
  return {
    url: `http://127.0.0.1:${port}`,
    failNext: (request) => {
      rules.push({
        method: request.method,
        path: request.path,
        status: request.status ?? 503,
        code: request.code,
        message: request.message,
        retryable: request.retryable
      })
    },
    stop: () => new Promise<void>((resolveStop, rejectStop) => {
      server.close((error) => {
        if (error) rejectStop(error)
        else resolveStop()
      })
    })
  }
}

/**
 * 把确定性旧 OS 夹具的页码目录投影为当前 UUID 游标合同。
 *
 * @param body 旧夹具返回的 UTF-8 JSON 响应体。
 * @returns 保留权威代际与项目摘要、移除页码元数据后的响应体。
 */
function normalizeWorkflowNodeTemplateCatalog(body: Buffer): Buffer {
  const envelope = JSON.parse(body.toString('utf8')) as {
    data?: Record<string, unknown>
  }
  if (!envelope.data || !Array.isArray(envelope.data.items)) return body
  const {
    total: _total,
    page: _page,
    page_size: _pageSize,
    ...currentData
  } = envelope.data
  return Buffer.from(JSON.stringify({
    ...envelope,
    data: {
      ...currentData,
      has_more: false,
      next_cursor_uuid: null
    }
  }))
}

/**
 * 为旧确定性 OS 夹具补齐当前只读增强目录。
 *
 * @param method HTTP 方法。
 * @param url 已解析的上游 URL。
 * @returns 当前合同响应；非增强目录请求返回 null 并继续代理。
 */
function currentFixtureCatalogResponse(
  method: string,
  url: URL
): string | null {
  if (method !== 'GET') return null
  if (url.pathname === '/api/v1/material-shapes') {
    return JSON.stringify({ code: 0, data: { items: [] } })
  }
  if (url.pathname !== '/api/v1/resource-templates') return null
  return JSON.stringify({
    code: 0,
    data: url.searchParams.has('limit')
      ? { items: [], has_more: false, next_cursor_uuid: null }
      : {
          revision: `sha256:${'0'.repeat(64)}`,
          stale: false,
          items: []
        }
  })
}

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createNetServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('failed to allocate a loopback port'))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) reject(error)
        else resolvePort(port)
      })
    })
  })
}

async function waitUntilReady(
  url: string,
  child: ChildProcess,
  logs: () => string
): Promise<void> {
  const endpoint =
    `${url}/api/v1/workflows/${AUTHORING_WORKFLOW_UUID}/authoring`
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `production Uni-Lab-OS exited with ${child.exitCode}\n${logs()}`
      )
    }
    try {
      const response = await fetch(endpoint)
      if (response.ok) return
    } catch {
      // Production composition is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`production Authoring did not become ready\n${logs()}`)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<boolean>((resolveExit) => {
    child.once('exit', () => resolveExit(true))
  })
  child.kill('SIGINT')
  const graceful = await Promise.race([
    exited,
    new Promise<boolean>((resolveTimeout) => {
      setTimeout(() => resolveTimeout(false), 5_000)
    })
  ])
  if (!graceful && child.exitCode === null) {
    child.kill('SIGKILL')
    await new Promise<void>((resolveExit) => {
      child.once('exit', () => resolveExit())
    })
  }
}

function removeFixtureDirectory(directory: string): void {
  if (
    resolve(directory).startsWith(resolve(tmpdir())) &&
    basename(directory).startsWith('unilab-authoring-os-')
  ) {
    rmSync(directory, { recursive: true, force: true })
  }
}
