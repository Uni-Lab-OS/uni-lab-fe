import {
  execFileSync,
  spawn,
  type ChildProcess
} from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

export const SZLAB_WORKFLOW_UUID =
  '67da810c-34f6-59c6-94ba-7e73dcc06207'
export const SZLAB_FIXTURE_SHA =
  '975e9b12282aeb68282022631d4ff5e30af3f0e9'
export const SZLAB_MATERIAL_WORKFLOW_UUID =
  '5e7ce142-bf5a-5d30-8666-fdf5374941f1'
export const SZLAB_MATERIAL_FIXTURE_SHA =
  '60a0fc00fc6be4d09ecfa8e83e1cc876e7cc3cce'
export const SZLAB_S06_WORKFLOW_UUID =
  '0b4e6fce-14bc-5866-a373-16ad25c7f8cf'
export const SZLAB_COMPOSITE_MATERIAL_WORKFLOW_UUID =
  '6d9fb3e2-4dcb-5f23-93b4-74d1b6083393'
export const SZLAB_COMPOSITE_MATERIAL_CHILD_WORKFLOW_UUID =
  'e7c53119-9fde-5250-9bf5-264f23d157a8'
export const SZLAB_COMPOSITE_MATERIAL_FIXTURE_SHA =
  'cc2bfe4757c33f4833f04d8bfce566347bc2cf74'

export interface SzlabActionCatalogOs {
  url: string
  workflowUuid: string
  logs: () => string
  stop: () => Promise<void>
}

export interface SzlabMaterialWorkflowOs extends SzlabActionCatalogOs {
  szlabRevision: string
}

export async function startSzlabActionCatalogOs(): Promise<SzlabActionCatalogOs> {
  return startSzlabOs({
    workflowUuid: SZLAB_WORKFLOW_UUID,
    fixtureSha: SZLAB_FIXTURE_SHA,
    applyCompatibility: true
  })
}

export async function startSzlabMaterialWorkflowOs(): Promise<SzlabMaterialWorkflowOs> {
  return startSzlabOs({
    workflowUuid: SZLAB_MATERIAL_WORKFLOW_UUID,
    fixtureSha: SZLAB_MATERIAL_FIXTURE_SHA,
    applyCompatibility: false,
    applyCompositeMaterial: false
  })
}

/** 启动并按“子工作流优先”顺序应用 SZLab 复合物料工作流。 */
export async function startSzlabCompositeMaterialWorkflowOs(): Promise<SzlabMaterialWorkflowOs> {
  return startSzlabOs({
    workflowUuid: SZLAB_COMPOSITE_MATERIAL_WORKFLOW_UUID,
    fixtureSha: SZLAB_COMPOSITE_MATERIAL_FIXTURE_SHA,
    applyCompatibility: false,
    applyCompositeMaterial: true
  })
}

/**
 * 启动当前 SZLab 物料感知工作流的并行任务验收运行时。
 *
 * @returns 真实 OS 公共 HTTP 地址、工作流身份、SZLab 修订和清理函数。
 * @throws 缺少审定 SZLab 修订、仓库不匹配或 OS 启动失败时抛出诊断异常。
 * @safety 普通作业只派发给保持运行的虚拟执行器，不连接或驱动真实设备。
 */
export async function startSzlabParallelMaterialWorkflowOs(): Promise<SzlabMaterialWorkflowOs> {
  // ``fixtureSha`` 是本次工作流任务（WorkflowTask）验收冻结的 SZLab 源码身份。
  const fixtureSha = requiredEnvironment('UNILAB_SZLAB_REVISION')
  return startSzlabOs({
    workflowUuid: SZLAB_COMPOSITE_MATERIAL_WORKFLOW_UUID,
    fixtureSha,
    applyCompatibility: false,
    applyCompositeMaterial: true,
    holdExecution: true
  })
}

/**
 * 启动绑定真实 S06 工作流定义的隔离 Uni-Lab-OS 创作夹具。
 *
 * @returns 已就绪的 OS 地址、S06 工作流 UUID、日志读取器和停止函数。
 * @throws 仓库缺失、依赖未就绪或 OS 健康检查失败时抛出诊断异常。
 * @safety 关闭兼容补丁且不启动真实设备执行，仅验证工作流创作接口。
 */
export async function startSzlabS06AuthoringOs(): Promise<SzlabMaterialWorkflowOs> {
  return startSzlabOs({
    workflowUuid: SZLAB_S06_WORKFLOW_UUID,
    fixtureSha: SZLAB_MATERIAL_FIXTURE_SHA,
    applyCompatibility: false
  })
}

async function startSzlabOs(options: {
  workflowUuid: string
  fixtureSha: string
  applyCompatibility: boolean
  applyCompositeMaterial?: boolean
  holdExecution?: boolean
}): Promise<SzlabMaterialWorkflowOs> {
  const osRepository = resolve(requiredEnvironment('UNILAB_A1_OS_ROOT'))
  const szlabSourceRepository = resolve(
    requiredEnvironment('UNILAB_SZLAB_REPOSITORY')
  )
  const python = process.env.UNILAB_OS_PYTHON || 'python'
  const directory = mkdtempSync(join(tmpdir(), 'unilab-a1-szlab-'))
  const szlabRepository = join(directory, 'szlab-fixture')
  const workingDirectory = join(directory, 'unilabos_data')
  try {
    execFileSync(
      'git',
      ['clone', '--no-hardlinks', '--quiet', szlabSourceRepository, szlabRepository],
      { stdio: 'pipe' }
    )
    execFileSync(
      'git',
      ['checkout', '--quiet', '--detach', options.fixtureSha],
      { cwd: szlabRepository, stdio: 'pipe' }
    )
    const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: szlabRepository,
      encoding: 'utf8'
    }).trim()
    if (actualSha !== options.fixtureSha) {
      throw new Error(`SZLab fixture SHA mismatch: ${actualSha}`)
    }
    if (options.applyCompatibility) {
      applyA1WorkflowInputCompatibility(szlabRepository)
    }
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    throw error
  }
  const port = await availablePort()
  const url = `http://127.0.0.1:${port}`
  let output = ''

  const child = spawn(
    python,
    [
      '-c',
      PYTHON_LAUNCHER,
      workingDirectory,
      szlabRepository,
      String(port),
      options.applyCompositeMaterial ? '1' : '0',
      options.holdExecution ? '1' : '0'
    ],
    {
      cwd: osRepository,
      env: {
        ...process.env,
        PYTHONPATH: [osRepository, szlabRepository]
          .filter(Boolean)
          .join(':'),
        PYTHONUNBUFFERED: '1'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    }
  )
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString()
  })
  try {
    await waitUntilReady(url, child, () => output)
  } catch (error) {
    await stopChild(child)
    rmSync(directory, { recursive: true, force: true })
    throw error
  }

  return {
    url,
    workflowUuid: options.workflowUuid,
    szlabRevision: options.fixtureSha,
    logs: () => output,
    stop: async () => {
      await stopChild(child)
      rmSync(directory, { recursive: true, force: true })
    }
  }
}

function applyA1WorkflowInputCompatibility(repository: string): void {
  const workflowPath = join(
    repository,
    'szlab_poly_studio/workflows/magnetic_stirring.py'
  )
  const source = readFileSync(workflowPath, 'utf8')
  const compatible = source
    .replace('speed: float = 300.0,', 'speed: int = 300,')
    .replace('temperature: float = 25.0,', 'temperature: int = 25,')
  if (
    compatible === source ||
    compatible.includes('speed: float = 300.0,') ||
    compatible.includes('temperature: float = 25.0,')
  ) {
    throw new Error('SZLab A1 input compatibility fixture no longer applies')
  }
  writeFileSync(workflowPath, compatible, 'utf8')
}

const PYTHON_LAUNCHER = String.raw`
import sqlite3
import sys
from pathlib import Path

from unilabos.config.config import BasicConfig
from unilabos.package_manager import (
    WorkspaceSource,
    compile_package_source,
    compile_registry_snapshot,
)
from unilabos.registry.registry import Registry
from unilabos.resources.graphio import read_node_link_json
from unilabos.workflow.composition import (
    get_workflow_service,
)
from unilabos.workflow.source_discovery import discover_editable_sources

working_dir = Path(sys.argv[1])
szlab_root = Path(sys.argv[2]).resolve()
port = int(sys.argv[3])
apply_composite_material = sys.argv[4] == "1"
hold_execution = sys.argv[5] == "1"
working_dir.mkdir(parents=True, exist_ok=True)

package_source = WorkspaceSource(szlab_root)
package_catalog = compile_package_source(package_source)
registry = Registry()
registry.device_type_registry = {}
registry.resource_type_registry = {}
registry._setup_called = False
registry.setup(external_only=True)
registry.publish_package_snapshot(compile_registry_snapshot((package_catalog,)))

BasicConfig.working_dir = str(working_dir)
# 工作区预编译计划已携带精确授权根；不能再并行启用遗留目录扫描入口。
BasicConfig.workflow_editable_package_roots = ()
BasicConfig.workflow_source_discovery_plan = discover_editable_sources((szlab_root,))
BasicConfig.control_plane = "local"
BasicConfig.process_role = "combined"

graph_path = szlab_root / "deployment" / "graphs" / "szlab-local-debug.json"
_graph, resource_tree_set, _links = read_node_link_json(str(graph_path))
from unilabos.registry.template_snapshot import RegistryTemplateSnapshot
from unilabos.app.scheduler.integration import (
    setup_edge_inventory,
    setup_edge_scheduler,
)

class HoldExecutionBackend:
    """只记录普通作业派发并保持运行的虚拟执行器。"""

    def __init__(self):
        """初始化空派发记录和完成监听器；参数、返回与异常均无。"""
        self.dispatched = []
        self.listeners = []

    def dispatch(self, payload):
        """记录派发载荷；参数为作业命令，返回无，且绝不产生物理效果。"""
        self.dispatched.append(dict(payload))

    def busy_device_action_keys(self):
        """返回空外部忙碌键集合；调度器仍保留进程内在途作业互斥。"""
        return set()

    def add_job_finished_listener(self, listener):
        """保存完成监听器；虚拟执行器不会主动完成或调用它。"""
        self.listeners.append(listener)

    def start(self):
        """启动虚拟执行器；无需线程或外部连接，返回无。"""
        return None

inventory_database = working_dir / "inventory.db"
setup_edge_inventory(
    str(inventory_database),
    resource_tree_set=resource_tree_set,
    registry_snapshot=RegistryTemplateSnapshot.from_registry(registry),
    resource_graph_source_id=graph_path.name,
)
setup_edge_scheduler(
    inventory_db_path=str(inventory_database),
    device_state_db_path="off",
    workflow_history_db_path="off",
    execution_backend=HoldExecutionBackend() if hold_execution else None,
)

from unilabos.app.web import server

server.setup_server()
workflow_service = get_workflow_service()
if workflow_service is None:
    raise RuntimeError("真实 OS 未发布工作流权威")

if apply_composite_material:
    def apply_workflow_source(workflow_uuid, source_path):
        """按子到父顺序规范化并应用工作流源码；失败时不发布部分候选。"""
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

    apply_workflow_source(
        "e7c53119-9fde-5250-9bf5-264f23d157a8",
        szlab_root / "szlab_poly_studio/workflows/material_transfer.py",
    )
    apply_workflow_source(
        "6d9fb3e2-4dcb-5f23-93b4-74d1b6083393",
        szlab_root / "szlab_poly_studio/workflows/single_sample_atomic_material.py",
    )

# 当前集成测试固定的 OS 运行时快照早于 Backend 同名微后端挂载；仅在该路由
# 缺席时，用工作流（Workflow）已持久化的真实资源模板（ResourceTemplate）
# 身份索引补齐同一读协议。产品代码不提供 fallback，且不会改写 OS 源码。
if not any(
    getattr(route, "path", None) == "/api/v1/resource-templates"
    and "GET" in (getattr(route, "methods", None) or set())
    for route in server.app.routes
):
    @server.app.get("/api/v1/resource-templates")
    def e2e_list_resource_templates(
        limit: int = 0,
        cursor_uuid: str | None = None,
        keyword: str = "",
        resource_type: str = "",
    ):
        page_size = 20 if limit <= 0 else min(limit, 100)
        with sqlite3.connect(working_dir / "workflow.db") as connection:
            rows = connection.execute(
                """
                SELECT resource_template_uuid, source_identity
                FROM workflow_resource_template_identity
                WHERE (? IS NULL OR resource_template_uuid > ?)
                ORDER BY resource_template_uuid
                """,
                (cursor_uuid, cursor_uuid),
            ).fetchall()
        items = [
            {
                "uuid": resource_template_uuid,
                "name": source_identity,
                "display_name": source_identity.rsplit(":", 1)[-1],
                "resource_type": "resource",
                "tags": [],
            }
            for resource_template_uuid, source_identity in rows
            if (not keyword or keyword.lower() in source_identity.lower())
            and (not resource_type or resource_type == "resource")
        ]
        page = items[:page_size]
        return {
            "code": 0,
            "data": {
                "items": page,
                "has_more": len(items) > page_size,
                "next_cursor_uuid": (
                    page[-1]["uuid"] if len(items) > page_size else None
                ),
            },
        }

server.start_server(
    host="127.0.0.1",
    port=port,
    open_browser=False,
)
`

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must point at the fixture repository`)
  return value
}

async function availablePort(): Promise<number> {
  return new Promise((resolvePort, rejectPort) => {
    const server = createServer()
    server.once('error', rejectPort)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        rejectPort(new Error('Unable to allocate local port'))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) rejectPort(error)
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
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`SZLab A1 OS exited with ${child.exitCode}\n${logs()}`)
    }
    let response: Response
    try {
      response = await fetch(`${url}/api/v1/workflow-node-templates`)
    } catch {
      if (child.exitCode !== null) {
        throw new Error(`SZLab A1 OS exited with ${child.exitCode}\n${logs()}`)
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      continue
    }
    if (response.ok) return
    throw new Error(
      `SZLab A1 catalog readiness returned ${response.status}\n${logs()}`
    )
  }
  throw new Error(`SZLab A1 OS did not become ready\n${logs()}`)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([
    new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
    new Promise<void>((resolveTimeout) => {
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
        resolveTimeout()
      }, 5_000)
    })
  ])
}
