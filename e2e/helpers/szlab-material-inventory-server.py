"""Serve the real SZLab graph through the production Inventory public router."""

from __future__ import annotations

import argparse
import signal
import uuid
from pathlib import Path

import uvicorn
from fastapi.middleware.cors import CORSMiddleware

if not hasattr(signal, "SIGRTMAX"):
    signal.SIGRTMAX = signal.SIGTERM

from unilabos.app.scheduler.inventory import (
    InventoryService,
    ResourceTemplateIdentity,
)
from unilabos.app.scheduler.inventory.api import create_app
from unilabos.app.scheduler.inventory.material_projection import (
    build_package_material_projection,
    build_resource_graph_import,
)
from unilabos.package_manager import WorkspaceSource, compile_package_source
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
    source = WorkspaceSource(root)
    catalog = compile_package_source(source)
    package_projection = build_package_material_projection((source,), (catalog,))
    resolved_identities = {
        definition.source_identity: str(
            uuid.uuid5(
                uuid.NAMESPACE_URL,
                f"unilabos:e2e-resource-template:{definition.source_identity}",
            )
        )
        for definition in package_projection.definitions.values()
    }
    templates = {
        template_uuid: ResourceTemplateIdentity(
            uuid=template_uuid,
            material_class=source_identity,
        )
        for source_identity, template_uuid in resolved_identities.items()
    }
    _, resource_tree_set, _ = read_node_link_json(str(root / args.graph))
    graph_snapshot = {
        "source_id": Path(args.graph).name,
        "nodes": [
            node.res_content.model_dump(by_alias=True)
            for node in resource_tree_set.all_nodes
        ],
    }
    inventory = InventoryService.open(
        working_dir=args.working_dir,
        resource_templates=templates,
        material_shapes=package_projection.shapes,
        material_model_assets=package_projection.model_assets,
    )
    inventory.bootstrap_resource_graph(
        build_resource_graph_import(
            graph_snapshot,
            package_projection,
            resolved_identities,
        )
    )

    app = create_app(inventory)
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
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
