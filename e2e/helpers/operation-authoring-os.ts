import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

export const OPERATION_WORKFLOW_UUID =
  '10000000-0000-4000-8000-000000000008'
export const OPERATION_NODE_UUID =
  '20000000-0000-4000-8000-000000000081'

export interface OperationAuthoringOs {
  url: string
  workflowUuid: string
  nodeUuid: string
  sourcePath: string
  databasePath: string
  logs(): string
  readDatabaseEvidence(workflowUuid?: string): Promise<OperationDatabaseEvidence>
  stopProcess(): Promise<void>
  restart(): Promise<void>
  stop(): Promise<void>
}

export interface OperationDatabaseEvidence {
  workflow_uuid: string
  workflow_revision: number
  package_root: string
  relative_path: string
  source_uri: string
  observed_draft_hash: string | null
  candidate_hash: string | null
  candidate: Record<string, unknown> | null
  applied_source: Record<string, unknown> | null
}

/** 启动只含一个真实 operation Definition 的当前 OS 公共 HTTP 夹具。 */
export async function startOperationAuthoringOs(): Promise<OperationAuthoringOs> {
  const osRepository = resolve(
    process.env.UNILAB_AUTHORING_OS_ROOT || '/home/wangtao/Uni-Lab-OS'
  )
  const python = process.env.UNILAB_OS_PYTHON ||
    '/home/wangtao/s07-feature-rerun-20260825/python-env/bin/python'
  const directory = mkdtempSync(join(tmpdir(), 'unilab-operation-os-'))
  const workingDirectory = join(directory, 'unilabos_data')
  const packageRoot = join(directory, 'editable', 'operation_lab')
  const sourcePath = join(packageRoot, 'workflows', 'operation.py')
  const databasePath = join(workingDirectory, 'workflow.db')
  const port = await availablePort()
  const url = `http://127.0.0.1:${port}`
  let child: ChildProcess | null = null
  let output = ''

  const launch = async (): Promise<void> => {
    child = spawn(python, [
      '-c',
      PYTHON_LAUNCHER,
      workingDirectory,
      packageRoot,
      String(port)
    ], {
      cwd: osRepository,
      env: {
        ...process.env,
        PYTHONPATH: osRepository,
        PYTHONUNBUFFERED: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const launched = child
    launched.stdout?.on('data', chunk => { output += chunk.toString() })
    launched.stderr?.on('data', chunk => { output += chunk.toString() })
    await waitUntilReady(url, launched, () => output)
  }

  try {
    await launch()
  } catch (error) {
    if (child) await stopChild(child)
    rmSync(directory, { recursive: true, force: true })
    throw error
  }

  return {
    url,
    workflowUuid: OPERATION_WORKFLOW_UUID,
    nodeUuid: OPERATION_NODE_UUID,
    sourcePath,
    databasePath,
    logs: () => output,
    readDatabaseEvidence: async (workflowUuid = OPERATION_WORKFLOW_UUID) => {
      const { stdout } = await promisify(execFile)(python, [
        '-c',
        PYTHON_DATABASE_READER,
        databasePath,
        workflowUuid
      ], {
        cwd: osRepository,
        env: { ...process.env, PYTHONPATH: osRepository },
        maxBuffer: 2 * 1024 * 1024
      })
      return JSON.parse(stdout) as OperationDatabaseEvidence
    },
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
      if (child) await stopChild(child)
      child = null
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

const PYTHON_LAUNCHER = String.raw`
import asyncio
import json
import sys
from pathlib import Path

import uvicorn
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from unilabos.app.workflow_api import create_workflow_app
from unilabos.workflow.authoring_engine import WorkflowAuthoringEngine
from unilabos.workflow.authoring_kernel import AuthoringCatalogSnapshot
from unilabos.workflow.service import WorkflowService
from unilabos.workflow.source_discovery import discover_editable_sources
from unilabos.workflow.store import WorkflowStore

working_dir = Path(sys.argv[1])
package_root = Path(sys.argv[2])
port = int(sys.argv[3])
source_path = package_root / "workflows" / "operation.py"
manifest_path = package_root.parent / "package.yaml"
database_path = working_dir / "workflow.db"
workflow_uuid = "${OPERATION_WORKFLOW_UUID}"
node_uuid = "${OPERATION_NODE_UUID}"
template_uuid = "30000000-0000-4000-8000-000000000008"
resource_template_uuid = "31000000-0000-4000-8000-000000000008"

action_schema = {
    "type": "object",
    "properties": {
        "goal": {
            "type": "object",
            "properties": {
                "report": {"type": "string", "title": "Report"},
            },
            "required": [],
            "additionalProperties": False,
        },
        "feedback": {},
        "result": {
            "type": "object",
            "properties": {"report": {"type": "string"}},
            "required": ["report"],
            "additionalProperties": False,
        },
    },
    "required": ["goal"],
    "x-unilabos-action-contract": {
        "version": 1,
        "input_order": ["report"],
        "output_order": ["report"],
        "resource_template_symbols": {"goal": {}, "result": {}},
    },
}
template = {
    "uuid": template_uuid,
    "resource_template_uuid": resource_template_uuid,
    "name": "finalize",
    "display_name": "Finalize",
    "class": "lab.devices:Reactor",
    "description": "Finalize one operation report.",
    "goal": {},
    "goal_default": {},
    "feedback": {},
    "result": {},
    "schema": json.dumps({
        "type": "object",
        "properties": {"report": {"type": "string", "title": "Report"}},
        "additionalProperties": False,
    }, sort_keys=True, separators=(",", ":")),
    "type": "action",
    "node_type": "py_script",
    "icon": None,
    "header": None,
    "footer": None,
    "meta_data": {
        "owner": "e2e",
        "unilab": {
            "action_contract_schema": action_schema,
            "resource_template": {
                "uuid": resource_template_uuid,
                "name": "reactor",
                "display_name": "Reactor",
            }
        },
    },
}

def value_handle(handle_uuid, io_type):
    return {
        "uuid": handle_uuid,
        "workflow_node_template_uuid": template_uuid,
        "handle_key": "report",
        "io_type": io_type,
        "display_name": "Report",
        "type": "string",
        "required": False,
        "description": None,
        "data_source": "executor",
        "data_key": "report",
        "meta_data": {
            "unilab": {
                "value_schema": {"type": "string", "title": "Report"},
                "editor_control": "variable_selector",
                "allowed_resource_template_uuids": None,
                "implicit_passthrough": False,
                "structural_role": None,
            }
        },
    }

def ready_handle(handle_uuid, io_type):
    return {
        "uuid": handle_uuid,
        "workflow_node_template_uuid": template_uuid,
        "handle_key": "ready",
        "io_type": io_type,
        "display_name": "Ready",
        "type": "boolean",
        "required": False,
        "description": None,
        "data_source": "dependency",
        "data_key": "ready",
        "meta_data": {
            "unilab": {
                "value_schema": {"type": "boolean"},
                "editor_control": "variable_selector",
                "allowed_resource_template_uuids": None,
                "implicit_passthrough": False,
                "structural_role": "ready",
            }
        },
    }

handles = [
    value_handle("40000000-0000-4000-8000-000000000081", "target"),
    value_handle("40000000-0000-4000-8000-000000000082", "source"),
    ready_handle("40000000-0000-4000-8000-000000000083", "target"),
    ready_handle("40000000-0000-4000-8000-000000000084", "source"),
]
catalog = AuthoringCatalogSnapshot.from_entities([template], handles)
compiler = WorkflowAuthoringEngine(catalog=catalog)

source = f'''from lab.devices import Reactor
from unilabos.workflow.authoring import device, workflow, workflow_output


reactor: Reactor = device()


@workflow(
    workflow_uuid="{workflow_uuid}",
    displayname="Runtime experiment operation",
    description="Catalog-backed experiment operation authoring fixture.",
    definition_kind="operation",
)
def runtime_experiment_operation(*, report_prefix: str = "operation"):
    # unilab:node_uuid={node_uuid}
    finalized = reactor.finalize(report=report_prefix)
    return workflow_output(report=finalized.report)
'''

working_dir.mkdir(parents=True, exist_ok=True)
source_path.parent.mkdir(parents=True, exist_ok=True)
if not manifest_path.exists():
    manifest_path.write_text(
        "package:\n"
        "  name: operation_lab\n"
        "workflows:\n"
        f"  - workflow_uuid: {workflow_uuid}\n"
        "    source: operation_lab/workflows/operation.py\n",
        encoding="utf-8",
    )
initialize = not database_path.exists()
store = WorkflowStore(database_path)
service = WorkflowService(store, compiler=compiler)
if initialize:
    service.create_workflow(
        workflow_uuid=workflow_uuid,
        name="Runtime experiment operation",
        tags=["operation"],
        description="Real operation authoring and persistence E2E",
        meta_data={"unilab": {"definition_kind": "operation"}},
    )
service.replace_discovered_source_authorizations(
    discover_editable_sources((package_root.parent,))
)
if initialize:
    aggregate = service.save_draft(
        workflow_uuid,
        python_source=source,
        expected_draft_hash=None,
        expected_workflow_revision=1,
    )
    candidate = aggregate["candidate"]
    if candidate is None:
        raise RuntimeError(aggregate)
    normalized = candidate["normalized_python_source"]
    if normalized != source:
        aggregate = service.save_draft(
            workflow_uuid,
            python_source=normalized,
            expected_draft_hash=aggregate["draft"]["draft_hash"],
            expected_workflow_revision=aggregate["workflow_revision"],
        )
        candidate = aggregate["candidate"]
    if candidate is None:
        raise RuntimeError(aggregate)
    service.apply_authoring(
        workflow_uuid,
        candidate_hash=candidate["candidate_hash"],
    )

class CatalogProvider:
    def snapshot(self):
        return catalog

app = create_workflow_app(
    service,
    template_snapshot_provider=CatalogProvider(),
    authoring_transform=compiler,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/v1/health")
def health():
    return {"status": "ok"}

@app.get("/api/v1/materials/graph")
def material_graph():
    """返回空的公共物料图，避免测试编辑器依赖未声明的私有库存接口。"""
    return {"code": 0, "data": {"nodes": []}}

@app.get("/api/v1/material-shapes")
def material_shapes():
    """返回当前空物料图对应的空 2.5D 外形目录。"""
    return {"code": 0, "data": {"items": []}}

@app.get("/api/v1/monitor/events")
async def monitor_events():
    """提供只读物料事件保活流，不创建或修改任何运行时事实。"""
    async def keep_alive():
        yield ": connected\n\n"
        while True:
            await asyncio.sleep(15)
            yield ": keep-alive\n\n"

    return StreamingResponse(keep_alive(), media_type="text/event-stream")

@app.on_event("shutdown")
def close_service():
    service.close()

uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
`

const PYTHON_DATABASE_READER = String.raw`
import json
import sqlite3
import sys

database_path = sys.argv[1]
workflow_uuid = sys.argv[2]
connection = sqlite3.connect(f"file:{database_path}?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
try:
    row = connection.execute(
        """
        SELECT workflow.uuid AS workflow_uuid,
               workflow.revision AS workflow_revision,
               registration.package_root,
               registration.relative_path,
               registration.source_uri,
               authoring.observed_draft_hash,
               authoring.candidate_hash,
               authoring.candidate,
               authoring.applied_source
        FROM workflow
        JOIN workflow_source_registration AS registration
          ON registration.workflow_uuid = workflow.uuid
        JOIN workflow_authoring AS authoring
          ON authoring.workflow_uuid = workflow.uuid
        WHERE workflow.uuid = ?
        """,
        (workflow_uuid,),
    ).fetchone()
    if row is None:
        raise RuntimeError("operation authoring row missing")
    result = dict(row)
    for key in ("candidate", "applied_source"):
        result[key] = json.loads(result[key]) if result[key] else None
    print(json.dumps(result, sort_keys=True))
finally:
    connection.close()
`

async function availablePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('cannot allocate operation OS port'))
        return
      }
      const port = address.port
      server.close(error => error ? reject(error) : resolvePort(port))
    })
  })
}

async function waitUntilReady(
  url: string,
  child: ChildProcess,
  logs: () => string
): Promise<void> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`operation OS exited with ${child.exitCode}\n${logs()}`)
    }
    try {
      const response = await fetch(
        `${url}/api/v1/workflows?page=1&page_size=1`
      )
      if (response.ok) return
    } catch {
      // Process is still starting.
    }
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
  }
  throw new Error(`operation OS did not become ready\n${logs()}`)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await new Promise<void>(resolveStop => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) child.kill('SIGKILL')
    }, 5_000)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveStop()
    })
  })
}
