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
    applyCompatibility: false
  })
}

async function startSzlabOs(options: {
  workflowUuid: string
  fixtureSha: string
  applyCompatibility: boolean
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
      String(port)
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
import copy
import sys
from pathlib import Path

from unilabos.config.config import BasicConfig
from unilabos.package_manager import WorkspaceSource, compile_package_source
from unilabos.registry.catalog_consumer import (
    workflow_template_imports_from_registry_snapshot,
)
from unilabos.registry.registry import Registry
from unilabos.workflow.catalog import (
    CatalogAuthority,
    LocalResourceTemplateIdentityIndex,
)
from unilabos.resources.graphio import read_node_link_json
from unilabos.workflow.composition import (
    compose_workflow_runtime,
    get_workflow_service,
    get_workflow_inventory_service,
)
from unilabos.workflow.service import WorkflowService
from unilabos.workflow.store import WorkflowStore

working_dir = Path(sys.argv[1])
szlab_root = Path(sys.argv[2]).resolve()
port = int(sys.argv[3])
working_dir.mkdir(parents=True, exist_ok=True)

package_source = WorkspaceSource(szlab_root)
package_catalog = compile_package_source(package_source)
registry = Registry()
registry.device_type_registry = {}
registry.resource_type_registry = {}
registry._setup_called = False
registry.setup(external_only=True, package_catalogs=[package_catalog])
registry_snapshot = copy.deepcopy(registry.device_type_registry)
resource_registry_snapshot = copy.deepcopy(registry.resource_type_registry)

authority = CatalogAuthority(authority_id="szlab-local", kind="local")
store = WorkflowStore(working_dir / "workflow.db")
try:
    service = WorkflowService(store)
    for definition in package_catalog.definitions.workflows:
        workflow_uuid = str(definition.details["workflow_uuid"])
        service.create_workflow(
            name=str(definition.id),
            tags=["szlab", "a1-e2e"],
            description="PackageCatalog 到前端 typed editor 的真实联调 fixture",
            meta_data={},
            workflow_uuid=workflow_uuid,
        )
finally:
    store.close()

BasicConfig.working_dir = str(working_dir)
BasicConfig.workflow_graph_authority = authority
BasicConfig.workflow_editable_package_roots = (szlab_root,)

graph_path = szlab_root / "deployment" / "graphs" / "szlab-local-debug.json"
_graph, resource_tree_set, _links = read_node_link_json(str(graph_path))
inventory_snapshot = {
    "source_id": graph_path.name,
    "nodes": [
        node.res_content.model_dump(by_alias=True)
        for node in resource_tree_set.all_nodes
    ],
}
workflow_service = compose_workflow_runtime(
    working_dir,
    authority=authority,
    editable_package_roots=(szlab_root,),
    registry_snapshot=registry_snapshot,
    resource_registry_snapshot=resource_registry_snapshot,
    workflow_package_catalogs=(package_catalog,),
    inventory_graph_snapshot=inventory_snapshot,
    package_sources=(package_source,),
    package_catalogs=(package_catalog,),
)
from unilabos.app.scheduler.integration import setup_edge_scheduler

setup_edge_scheduler(
    inventory_service=get_workflow_inventory_service(),
    workflow_tasks=workflow_service,
    device_state_db_path="off",
    workflow_history_db_path="off",
)

from unilabos.app.web import server

server.setup_server(
    registry_snapshot=registry_snapshot,
    resource_registry_snapshot=resource_registry_snapshot,
    workflow_package_catalogs=(package_catalog,),
)

@server.app.post("/__e2e/catalog-bump")
def bump_catalog():
    bumped = copy.deepcopy(registry_snapshot)
    changed = False
    for device in bumped.values():
        actions = device.get("class", {}).get("action_value_mappings", {})
        action = actions.get("run_stirring")
        if not isinstance(action, dict):
            continue
        position = action["schema"]["properties"]["goal"]["properties"]["position"]
        position["description"] = "A1 E2E catalog revision 2"
        changed = True
        break
    if not changed:
        raise RuntimeError("run_stirring action missing")
    service = get_workflow_service()
    known_source_identities = {
        device.get("source_fqid") or registry_key
        for registry_key, device in bumped.items()
        if isinstance(device, dict)
    }
    known_source_identities.update(
        resource.get("class", {}).get("module")
        for resource in resource_registry_snapshot.values()
        if isinstance(resource, dict)
        and isinstance(resource.get("class", {}).get("module"), str)
    )
    identity_index = LocalResourceTemplateIdentityIndex(
        service._store,
        authority,
        sorted(known_source_identities),
    )
    imports = workflow_template_imports_from_registry_snapshot(
        bumped,
        authority_id=authority.authority_id,
        resource_template_identity_resolver=identity_index,
    )
    snapshot = service.compiler.template_catalog.replace(authority, imports)
    return {
        "code": 0,
        "data": {"catalog_fingerprint": snapshot.fingerprint},
        "error": None,
    }

server.start_server(
    host="127.0.0.1",
    port=port,
    open_browser=False,
    registry_snapshot=registry_snapshot,
    resource_registry_snapshot=resource_registry_snapshot,
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
