"""Production-composition OS fixture for the D1A-S1 browser gate.

The browser talks only to real Uni-Lab-OS HTTP/SSE routes.  This fixture owns a
test HostNode implementation at the physical-driver boundary so the production
EdgeScheduler, JobExecutionBackend, D1A Task/Job bridge, catalog projection and
global event stream all remain in the exercised path.
"""

from __future__ import annotations

import copy
import os
import sys
import threading
import time
from pathlib import Path
from typing import Any

import uvicorn

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
from unilabos.workflow.composition import compose_workflow_runtime

DEVICE_ID = "D1ADevice1"
ACTION_NAME = "test_hold"


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
from unilabos.registry.placeholder_type import ResourceSlot


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

    @action(description="需要工作流物料上下文", displayname="转移物料")
    def move_sample(self, sample: ResourceSlot) -> None:
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

    def __init__(self, action_definitions: dict[str, Any]) -> None:
        self.devices_names = {DEVICE_ID: "/devices"}
        self.device_machine_names = {DEVICE_ID: "D1A E2E Edge"}
        self._online_devices = {f"/devices/{DEVICE_ID}"}
        self._action_value_mappings = {
            DEVICE_ID: copy.deepcopy(action_definitions)
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
    package_root = working_dir / "package"
    _write_package(package_root)
    device_snapshot, resource_snapshot = _registry_snapshot(package_root)
    owner = next(iter(device_snapshot.values()))
    action_definitions = copy.deepcopy(owner["class"]["action_value_mappings"])
    action_definitions[ACTION_NAME]["label"] = "单节点运行"
    action_definitions["move_sample"]["label"] = "转移物料"

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
    host = DriverBoundaryHost(action_definitions)
    HostNode.get_instance = classmethod(  # type: ignore[method-assign]
        lambda cls, timeout=None: host
    )
    workflow_service = compose_workflow_runtime(
        BasicConfig.working_dir,
        authority=BasicConfig.workflow_graph_authority,
        editable_package_roots=BasicConfig.workflow_editable_package_roots,
        registry_snapshot=device_snapshot,
        resource_registry_snapshot=resource_snapshot,
    )
    _scheduler, backend = setup_edge_scheduler(
        ws_client=client,
        host_node_getter=lambda: host,
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

    @app.get("/api/v1/materials/graph")
    async def empty_material_graph() -> dict[str, Any]:
        return {"code": 0, "data": {"nodes": []}}

    @app.get("/api/v1/material-shapes")
    async def empty_material_shapes() -> dict[str, Any]:
        return {"code": 0, "data": {"items": []}}

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
