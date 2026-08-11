"""Production-composition OS fixture for the D1A-S1 browser gate.

The browser talks only to real Uni-Lab-OS HTTP/SSE routes.  This fixture owns a
test HostNode implementation at the physical-driver boundary so the production
EdgeScheduler, JobExecutionBackend, D1A Task/Job bridge, catalog projection and
global event stream all remain in the exercised path.
"""

from __future__ import annotations

import copy
import json
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

import uvicorn
from fastapi import Request
from fastapi.responses import JSONResponse

from unilabos.app.communication import CommunicationClientFactory
from unilabos.app.scheduler.integration import setup_edge_scheduler
from unilabos.app.ws_client import WebSocketClient
from unilabos.config.config import BasicConfig
from unilabos.package_manager import WorkspaceSource, compile_package_source
from unilabos.registry.catalog_consumer import register_package_catalog
from unilabos.registry.registry import Registry
from unilabos.ros.nodes.presets.host_node import HostNode
from unilabos.utils.type_check import serialize_result_info
from unilabos.workflow.catalog import CatalogAuthority
from unilabos.workflow.composition import (
    compose_workflow_runtime,
    get_workflow_inventory_service,
)

DEVICE_ID = "D1ADevice1"
ACTION_NAME = "test_hold"
DEVICE_MATERIAL_UUID = str(uuid5(NAMESPACE_URL, f"d1a-e2e:{DEVICE_ID}"))


def _resource_template_uuid(source_fqid: str) -> str:
    """为测试设备类型生成跨重启稳定的资源模板身份。

    Args:
        source_fqid: 包目录发布的完整设备类型身份。

    Returns:
        基于命名空间生成的规范资源模板 UUID。

    Raises:
        不主动抛出异常；输入由包目录编译器提供。

    Safety:
        稳定映射确保动作目录与库存中的设备物料引用同一资源模板。
    """
    return str(uuid5(NAMESPACE_URL, f"d1a-e2e-template:{source_fqid}"))


def _write_package(root: Path) -> None:
    (root / "d1a_e2e_device").mkdir(parents=True, exist_ok=True)
    (root / "pyproject.toml").write_text(
        """
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "d1a-e2e-device"
version = "1.0.0"

[tool.setuptools.packages.find]
include = ["d1a_e2e_device*"]
""".strip(),
        encoding="utf-8",
    )
    (root / "d1a_e2e_device" / "__init__.py").write_text("", encoding="utf-8")
    (root / "d1a_e2e_device" / "device.py").write_text(
        """
from typing import Annotated, TypedDict

from pydantic import Field

from unilabos.registry.decorators import action, device


class HoldResult(TypedDict):
    completed: bool
    cycles: int


@device(id="instrument", category=["test"], displayname="D1A E2E 仪器")
class Instrument:
    @action(description="D1A 单节点运行", displayname="单节点运行")
    def test_hold(
        self,
        duration_seconds: Annotated[int, Field(title="执行时长", ge=1, le=30)] = 3,
    ) -> HoldResult:
        raise NotImplementedError
""".strip(),
        encoding="utf-8",
    )


def _registry_snapshot(package_root: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    catalog = compile_package_source(WorkspaceSource(package_root))
    registry = Registry()
    registry.device_type_registry = {}
    registry.resource_type_registry = {}
    register_package_catalog(registry, catalog)
    return (
        copy.deepcopy(registry.device_type_registry),
        copy.deepcopy(registry.resource_type_registry),
    )


class DriverBoundaryHost:
    """Deterministic physical-driver boundary; all runtime owners stay production."""

    def __init__(self, action_definition: dict[str, Any]) -> None:
        self.devices_names = {DEVICE_ID: "/devices"}
        self.device_machine_names = {DEVICE_ID: "D1A E2E Edge"}
        self._online_devices = {f"/devices/{DEVICE_ID}"}
        self._action_value_mappings = {
            DEVICE_ID: {ACTION_NAME: copy.deepcopy(action_definition)}
        }
        self._device_action_status: dict[str, Any] = {}
        self._subscribed_topics: set[str] = set()
        self._action_clients: dict[str, Any] = {}
        self.device_status: dict[str, Any] = {}
        self.device_status_timestamps: dict[str, Any] = {}
        self.devices_instances: dict[str, Any] = {}
        self.available = True
        self.backend: Any | None = None
        self._cancelled: set[str] = set()
        self._cancel_lock = threading.Lock()

    def send_goal(
        self,
        item: Any,
        *,
        action_type: str,
        action_kwargs: dict[str, Any],
        sample_material: dict[str, Any],
        server_info: Any = None,
    ) -> None:
        del action_type, sample_material, server_info
        if self.backend is None:
            raise RuntimeError("D1A E2E backend is not attached")
        duration = int(action_kwargs.get("duration_seconds", 3))
        self.backend.publish_job_status({"progress": 0.25}, item, "running")
        threading.Thread(
            target=self._complete,
            args=(item, duration),
            daemon=True,
            name=f"d1a-e2e-{item.job_id[:8]}",
        ).start()

    def cancel_goal_or_defer(self, job_uuid: str) -> bool:
        with self._cancel_lock:
            self._cancelled.add(job_uuid)
        return True

    def _complete(self, item: Any, duration: int) -> None:
        halfway_sent = False
        deadline = time.monotonic() + duration
        while time.monotonic() < deadline:
            with self._cancel_lock:
                canceled = item.job_id in self._cancelled
            if canceled:
                assert self.backend is not None
                self.backend.publish_job_status(
                    {},
                    item,
                    "failed",
                    serialize_result_info("Job was cancelled", False, {}),
                )
                return
            remaining = deadline - time.monotonic()
            if not halfway_sent and remaining <= duration / 2:
                halfway_sent = True
                assert self.backend is not None
                self.backend.publish_job_status(
                    {"progress": 0.75}, item, "running"
                )
            time.sleep(0.05)
        assert self.backend is not None
        self.backend.publish_job_status(
            {"progress": 1.0},
            item,
            "success",
            serialize_result_info(
                "",
                True,
                {"completed": True, "cycles": duration},
            ),
        )


def create_fixture_app(working_dir: Path):
    """组装连接正式调度与库存权威的单动作端到端测试应用。

    Args:
        working_dir: 本次测试独占的运行目录，用于保存工作流与库存数据库。

    Returns:
        复用生产 HTTP 路由、调度器和设备驱动边界的 FastAPI 应用。

    Raises:
        RuntimeError: 组合根未提供库存权威时拒绝启动，避免绕过占用审计。

    Safety:
        工作流服务与库存服务来自同一次组合，终止与解锁测试不会使用伪造锁权威。
    """
    package_root = working_dir / "package"
    _write_package(package_root)
    device_snapshot, resource_snapshot = _registry_snapshot(package_root)
    owner = next(iter(device_snapshot.values()))
    action_definition = copy.deepcopy(
        owner["class"]["action_value_mappings"][ACTION_NAME]
    )
    action_definition["label"] = "单节点运行"

    BasicConfig.communication_protocol = "websocket"
    BasicConfig.machine_name = "D1A E2E Edge"
    BasicConfig.working_dir = str(working_dir / "unilabos_data")
    BasicConfig.workflow_graph_authority = CatalogAuthority(
        authority_id="os-local",
        kind="local",
    )
    BasicConfig.workflow_editable_package_roots = ()

    client = WebSocketClient()
    CommunicationClientFactory._client_cache = client
    host = DriverBoundaryHost(action_definition)
    HostNode.get_instance = classmethod(  # type: ignore[method-assign]
        lambda cls, timeout=None: host
    )
    workflow_service = compose_workflow_runtime(
        BasicConfig.working_dir,
        authority=BasicConfig.workflow_graph_authority,
        editable_package_roots=BasicConfig.workflow_editable_package_roots,
        registry_snapshot=device_snapshot,
        resource_registry_snapshot=resource_snapshot,
        resource_template_identity_resolver=_resource_template_uuid,
    )
    inventory_service = get_workflow_inventory_service()
    if inventory_service is None:
        raise RuntimeError("D1A E2E inventory authority is unavailable")
    device_source_fqid = next(iter(device_snapshot))
    inventory_service.bootstrap_resource_graph(
        {
            "source_id": "d1a-e2e-device.json",
            "fingerprint": "sha256:" + "d" * 64,
            "materials": [
                {
                    "uuid": DEVICE_MATERIAL_UUID,
                    "resource_template_uuid": _resource_template_uuid(
                        device_source_fqid
                    ),
                    "parent_uuid": None,
                    "class": "Instrument",
                    "barcode": "",
                    "name": DEVICE_ID,
                    "description": "D1A E2E selected executor",
                    "meta_data": {
                        "source": "resource-tree-set",
                        "source_node_id": DEVICE_ID,
                    },
                    "config": {},
                    "data": {},
                    "material_kind": "device",
                }
            ],
            "relative_positions": [],
            "sites": [],
        }
    )
    _scheduler, backend = setup_edge_scheduler(
        ws_client=client,
        host_node_getter=lambda: host,
        inventory_service=inventory_service,
        workflow_tasks=workflow_service,
        device_state_db_path="off",
        workflow_history_db_path=str(working_dir / "workflow-history.db"),
    )
    host.backend = backend

    from unilabos.app.web import server

    app = server.setup_server(
        registry_snapshot=device_snapshot,
        resource_registry_snapshot=resource_snapshot,
    )
    from unilabos.workflow.composition import get_device_action_task_service

    device_action_tasks = get_device_action_task_service()
    if device_action_tasks is None:
        raise RuntimeError("D1A E2E device Action Task service is unavailable")

    @app.post("/api/v1/device-action-runs")
    async def create_backend_shaped_device_action_run(
        request: Request,
    ) -> JSONResponse:
        """把当前 Backend DTO 适配到候选 OS 的正式单动作服务。

        Args:
            request: 前端提交的设备单动作运行（DeviceActionRun）请求。

        Returns:
            当前前端消费的标准工作流任务（WorkflowTask）与节点作业结果。

        Raises:
            设备物料或动作模板身份不一致时显式终止测试。

        Safety:
            适配仅改变测试 HTTP 外壳，持久化、调度与设备锁仍由正式 OS 服务负责。
        """
        body = await request.json()
        if body.get("material_uuid") != DEVICE_MATERIAL_UUID:
            raise RuntimeError("D1A E2E device material identity mismatch")
        template_uuid = str(body.get("workflow_node_template_uuid") or "")
        with device_action_tasks._template_catalog.snapshot(  # noqa: SLF001
            device_action_tasks._authority  # noqa: SLF001
        ) as snapshot:
            fingerprint = snapshot.fingerprint
        view = device_action_tasks.create(
            authority_id=device_action_tasks._authority.authority_id,  # noqa: SLF001
            template_catalog_fingerprint=fingerprint,
            workflow_node_template_uuid=template_uuid,
            device_id=DEVICE_ID,
            input_value=dict(body.get("param") or {}),
            idempotency_key=str(body.get("idempotency_key") or ""),
            description=body.get("description"),
        )
        store = device_action_tasks._store  # noqa: SLF001
        task = store.get_task(view["task_uuid"])
        jobs = store.list_jobs(view["task_uuid"])
        if len(jobs) != 1:
            raise RuntimeError("D1A E2E run must create exactly one Job")
        return JSONResponse(
            {"code": 0, "data": {"task": task, "job": jobs[0], "created": True}},
            status_code=201,
        )

    @app.middleware("http")
    async def normalize_node_template_cursor(
        request: Request,
        call_next: Any,
    ) -> Any:
        """让测试边界发布前端当前要求的 UUID 游标目录合同。

        Args:
            request: 进入真实 OS FastAPI 应用的 HTTP 请求。
            call_next: 继续调用生产路由的 ASGI 中间件回调。

        Returns:
            非目录请求保持生产响应；目录响应仅替换分页外壳，条目与代际仍来自生产路由。

        Raises:
            JSON 解码错误会显式终止测试，避免旧分页合同被静默接受。

        Safety:
            适配只存在于浏览器测试夹具，不改变 OS 仓库或生产动作执行链。
        """
        path = request.url.path
        task_prefix = "/api/v1/workflow-tasks/"
        browser_headers = {
            "Access-Control-Allow-Origin": request.headers.get("origin", "*"),
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
        if request.method == "GET" and path.startswith(task_prefix):
            suffix = path.removeprefix(task_prefix)
            task_uuid, separator, child = suffix.partition("/")
            store = device_action_tasks._store  # noqa: SLF001
            if task_uuid and store.is_device_action_task(task_uuid):
                if not separator:
                    return JSONResponse(
                        {"code": 0, "data": store.get_task(task_uuid)},
                        headers=browser_headers,
                    )
                if child == "jobs":
                    return JSONResponse(
                        {"code": 0, "data": store.list_jobs(task_uuid)},
                        headers=browser_headers,
                    )

        response = await call_next(request)
        if (
            request.method == "GET"
            and path == "/api/v1/devices"
            and response.status_code == 200
        ):
            body = b"".join([chunk async for chunk in response.body_iterator])
            payload = json.loads(body)
            for item in payload.get("data", {}).get("items", []):
                if item.get("id") == DEVICE_ID:
                    item["materialUuid"] = DEVICE_MATERIAL_UUID
            return JSONResponse(
                payload,
                status_code=response.status_code,
                headers={
                    key: value
                    for key, value in response.headers.items()
                    if key.lower() != "content-length"
                },
            )
        if (
            request.method != "GET"
            or path != "/api/v1/workflow-node-templates"
            or response.status_code != 200
        ):
            return response
        body = b"".join([chunk async for chunk in response.body_iterator])
        payload = json.loads(body)
        data = payload["data"]
        for legacy_field in ("total", "page", "page_size"):
            data.pop(legacy_field, None)
        data["has_more"] = False
        data["next_cursor_uuid"] = None
        return JSONResponse(
            payload,
            status_code=response.status_code,
            headers={
                key: value
                for key, value in response.headers.items()
                if key.lower() != "content-length"
            },
        )

    return app


if __name__ == "__main__":
    fixture_working_dir = Path(sys.argv[1]).resolve()
    fixture_working_dir.mkdir(parents=True, exist_ok=True)
    uvicorn.run(
        create_fixture_app(fixture_working_dir),
        host="127.0.0.1",
        port=int(os.environ.get("UNILAB_D1A_E2E_PORT", "18124")),
        log_level="warning",
    )
