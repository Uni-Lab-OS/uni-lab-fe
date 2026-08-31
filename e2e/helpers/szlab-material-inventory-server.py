"""Serve the real SZLab graph through the production Inventory public router."""

from __future__ import annotations

import argparse
import ast
import asyncio
import os
import re
import signal
import uuid
from datetime import UTC, datetime
from pathlib import Path

import uvicorn
from fastapi import WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

if not hasattr(signal, "SIGRTMAX"):
    signal.SIGRTMAX = signal.SIGTERM

from unilabos.app.scheduler.inventory import (
    InventoryService,
    InventoryStore,
)
from unilabos.app.scheduler.inventory.api import create_app
from unilabos.app.scheduler.inventory.backend_api import (
    install_backend_resource_api,
)
from unilabos.app.scheduler.inventory.backend_contract import (
    BackendResourceService,
)
from unilabos.app.scheduler.inventory.layout import create_lab_router
from unilabos.app.scheduler.inventory.resource_graph_bootstrap import (
    bootstrap_local_resource_graph,
)
from unilabos.package_manager import (
    compile_workspace_material_models,
    prepare_workspace_registry_runtime,
)
from unilabos.registry.registry import lab_registry
from unilabos.registry.template_snapshot import RegistryTemplateSnapshot
from unilabos.resources.graphio import read_node_link_json


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--working-dir", required=True)
    parser.add_argument("--szlab-root", required=True)
    parser.add_argument("--graph", required=True)
    parser.add_argument("--port", required=True, type=int)
    parser.add_argument("--allow-origin", required=True)
    args = parser.parse_args()

    root = Path(args.szlab_root).resolve()
    runtime_arguments = {
        "workspace": str(root),
        "graph": args.graph,
    }
    runtime = prepare_workspace_registry_runtime(runtime_arguments)
    if runtime is None:
        raise RuntimeError("SZLab 工作区运行时未创建")
    runtime.publish(lab_registry)
    runtime.activate_import_path()
    material_model_catalog = compile_workspace_material_models(
        runtime.startup_plan,
        runtime.catalog,
    )
    _, resource_tree_set, _ = read_node_link_json(runtime.graph_copy())
    inventory_store = InventoryStore(
        str(Path(args.working_dir).resolve() / "inventory.db")
    )
    inventory = InventoryService(inventory_store)
    bootstrap_local_resource_graph(
        store=inventory_store,
        resource_tree_set=resource_tree_set,
        registry_snapshot=RegistryTemplateSnapshot.from_registry(lab_registry),
        source_id=str(runtime.graph_path),
        material_rendering_by_template=material_model_catalog.models_by_template,
    )

    app = create_app(inventory)
    install_backend_resource_api(
        app,
        BackendResourceService(inventory_store),
        material_shapes=runtime.material_shapes,
        material_model_catalog=material_model_catalog,
    )
    app.include_router(create_lab_router(inventory))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[args.allow_origin],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_api_route(
        "/api/v1/health",
        lambda: {"code": 0, "data": {"status": "ok"}},
        methods=["GET"],
    )
    install_material_transfer_workflow_fixture(app, root)
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


def install_material_transfer_workflow_fixture(app, root: Path) -> None:
    """Expose a read-only Workflow fixture parsed from the real SZLab source."""

    workflow_uuid = "6d9fb3e2-4dcb-5f23-93b4-74d1b6083393"
    task_uuid = "c49f7b30-e52a-4b2a-9770-b006e77ec151"
    workflow_root = Path(
        os.environ.get("UNILAB_E2E_SZLAB_WORKFLOW_ROOT", str(root))
    ).resolve()
    source_path = (
        workflow_root
        / "szlab_poly_studio"
        / "workflows"
        / "single_sample_atomic_material.py"
    )
    if not source_path.is_file():
        return
    source = source_path.read_text(encoding="utf-8")
    graph = transfer_graph_from_source(source, workflow_uuid)
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    jobs = [
        workflow_job(
            task_uuid,
            str(node["uuid"]),
            index,
            (
                "succeeded"
                if node["name"] == "beaker_at_s07"
                else "running"
                if node["name"] == "fine_at_s07"
                else "pending"
            ),
            now,
        )
        for index, node in enumerate(graph["nodes"])
    ]
    task = {
        "uuid": task_uuid,
        "create_time": now,
        "update_time": now,
        "description": "真实 SZLab 源码派生的 3D 物料转运只读夹具",
        "meta_data": {},
        "workflow_uuid": workflow_uuid,
        "status": "running",
        "workflow_snapshot": graph,
        "execution_plan": {},
        "run_mode": "normal",
        "control_status": "active",
        "cleanup_status": "none",
        "trace_context": {},
        "input": {},
        "output": {},
        "error_info": [],
        "started_at": now,
    }

    @app.get(f"/api/v1/workflows/{workflow_uuid}/authoring")
    def e2e_material_transfer_authoring():
        return {
            "code": 0,
            "data": {
                "workflow_uuid": workflow_uuid,
                "workflow_revision": 1,
                "state": "applied",
                "applied_graph": graph,
                "draft": None,
                "candidate": None,
                "applied_source": None,
            },
        }

    @app.get("/api/v1/workflow-node-templates")
    def e2e_workflow_node_templates(page: int = 1, page_size: int = 100):
        return {
            "code": 0,
            "data": {
                "authority": {"authority_id": "e2e-szlab", "kind": "local"},
                "catalog_fingerprint": f"sha256:{'0' * 64}",
                "items": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
            },
        }

    @app.get("/api/v1/workflow-tasks")
    def e2e_material_transfer_tasks(
        workflow_uuid: str | None = None,
        page: int = 1,
        page_size: int = 1,
        status: str | None = None,
        cleanup_status: str | None = None,
    ):
        items = [task] if workflow_uuid in (None, task["workflow_uuid"]) else []
        return {
            "code": 0,
            "data": {
                "items": items,
                "total": len(items),
                "page": page,
                "page_size": page_size,
            },
        }

    @app.get(f"/api/v1/workflow-tasks/{task_uuid}")
    def e2e_material_transfer_task():
        return {"code": 0, "data": task}

    @app.get(f"/api/v1/workflow-tasks/{task_uuid}/jobs")
    def e2e_material_transfer_jobs():
        return {"code": 0, "data": jobs}

    @app.get("/api/v1/workflow-node-jobs/{job_uuid}/feedback")
    def e2e_material_transfer_job_feedback(
        job_uuid: str,
        after_sequence: int = 0,
        limit: int = 100,
    ):
        return {
            "code": 0,
            "data": {
                "items": [],
                "next_cursor": after_sequence,
                "has_more": False,
            },
        }

    async def event_stream():
        while True:
            yield ": material-transfer-fixture\n\n"
            await asyncio.sleep(5)

    @app.get("/api/v1/events")
    def e2e_workflow_events():
        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @app.get("/api/v1/monitor/events")
    def e2e_monitor_events():
        """保持物料监控 SSE 可连接，场景夹具不主动伪造状态变化。"""

        return StreamingResponse(event_stream(), media_type="text/event-stream")

    @app.websocket("/api/v1/ws/device_status")
    async def e2e_device_status(websocket: WebSocket):
        await websocket.accept()
        try:
            while True:
                await websocket.send_json(
                    {
                        "type": "device_status",
                        "data": {
                            "device_status": {},
                            "device_status_timestamps": {},
                        },
                    }
                )
                await asyncio.sleep(1)
        except WebSocketDisconnect:
            return


def transfer_graph_from_source(source: str, workflow_uuid: str) -> dict:
    tree = ast.parse(source)
    node_uuid_marks = [
        (index, match.group(1))
        for index, line in enumerate(source.splitlines(), start=1)
        if (match := re.search(r"# unilab:node_uuid=([0-9a-f-]+)", line))
    ]
    template_uuid = "d4b6d1fa-91d1-4cee-9438-cb4602508fe0"
    nodes = []
    for call in ast.walk(tree):
        if not isinstance(call, ast.Call) or call_name(call.func) != "s_z_lab_标准物料转运":
            continue
        parameters = {
            keyword.arg: fixture_argument(keyword.value)
            for keyword in call.keywords
            if keyword.arg is not None
        }
        node_uuid = max(
            (mark for line, mark in node_uuid_marks if line <= call.lineno),
            key=lambda mark: next(
                line for line, candidate in node_uuid_marks if candidate == mark
            ),
        )
        parent = next(
            (
                candidate
                for candidate in ast.walk(tree)
                if isinstance(candidate, ast.Assign) and candidate.value is call
            ),
            None,
        )
        name = (
            parent.targets[0].id
            if isinstance(parent, ast.Assign)
            and isinstance(parent.targets[0], ast.Name)
            else f"material_transfer_{len(nodes) + 1}"
        )
        nodes.append(
            {
                "uuid": node_uuid,
                "name": name,
                "type": "workflow",
                "workflow_node_template_uuid": template_uuid,
                "parent_uuid": None,
                "param": parameters,
                "pose": {"position": {"x": 0, "y": len(nodes) * 120}},
            }
        )
    return {
        "workflow": {
            "uuid": workflow_uuid,
            "name": "SZLab 单样品全流程（物料感知）",
            "revision": 1,
            "meta_data": {},
        },
        "nodes": nodes,
        "edges": [],
        "node_templates": [
            {
                "uuid": template_uuid,
                "name": "workflow:material_transfer",
                "display_name": "标准物料转运",
                "type": "workflow",
                "node_type": "workflow",
                "meta_data": {
                    "unilab": {
                        "framework_owner_only": True,
                        "workflow_source": {
                            "kind": "package",
                            "module": "szlab_poly_studio.workflows.material_transfer",
                            "symbol": "s_z_lab_标准物料转运",
                            "definition_fqid": (
                                "szlab_poly_studio.workflows.material_transfer."
                                "s_z_lab_标准物料转运"
                            ),
                        },
                    }
                },
                "schema": {
                    "x-unilabos-workflow-contract": {
                        "version": 1,
                        "workflow_uuid": "e7c53119-9fde-5250-9bf5-264f23d157a8",
                        "contract_digest": "sha256:e2e-material-transfer",
                    }
                },
            }
        ],
        "handle_templates": [],
    }


def call_name(function: ast.expr) -> str:
    if isinstance(function, ast.Name):
        return function.id
    if isinstance(function, ast.Attribute):
        return function.attr
    return ""


def fixture_argument(value: ast.expr):
    if isinstance(value, ast.Constant):
        return value.value
    if (
        isinstance(value, ast.Call)
        and call_name(value.func) == "resource_ref"
        and value.args
        and isinstance(value.args[0], ast.Constant)
    ):
        return {"uuid": value.args[0].value}
    if isinstance(value, ast.Name):
        return {"uuid": value.id}
    return None


def workflow_job(
    task_uuid: str,
    workflow_node_uuid: str,
    index: int,
    status: str,
    now: str,
) -> dict:
    return {
        "uuid": str(uuid.uuid5(uuid.NAMESPACE_URL, f"e2e-job:{workflow_node_uuid}")),
        "create_time": now,
        "update_time": now,
        "meta_data": {},
        "workflow_task_uuid": task_uuid,
        "workflow_node_uuid": workflow_node_uuid,
        "feedback_sequence": 0,
        "topological_index": index,
        "executor_kind": "workflow",
        "execution_policy": {},
        "execution_timeout_seconds": 300,
        "status": status,
        "attempt": 1,
        "param": {},
        "feedback_data": {},
        "return_info": {},
        "control_data": {},
        "error_info": [],
    }


if __name__ == "__main__":
    main()
