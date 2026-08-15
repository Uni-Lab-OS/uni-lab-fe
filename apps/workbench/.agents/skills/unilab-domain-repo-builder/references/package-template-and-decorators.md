# Domain package template and decorators

Read this reference when creating a new UniLab domain repository, converting an existing device collection, adding a device/resource, or repairing registry discovery.

The minimal upstream `LabDeviceTemplate` is intentionally small. A domain package extends it with resources, Workflows, configuration, and tests while remaining an ordinary independently versioned Python package. Always verify signatures against the selected installed OS.

## 1. Recommended repository layout

```text
<repo>/
├── pyproject.toml
├── requirements.txt                 # Keep only if launcher/check_mode consumes it
├── package.yaml                     # Workflow package manifest
├── README.md
├── .gitignore
├── .github/
│   └── workflows/
│       └── check_registry.yml
├── <import_package>/
│   ├── __init__.py                  # Import-safe; avoid registration side effects
│   ├── devices/
│   │   ├── __init__.py
│   │   └── <device_name>/
│   │       ├── __init__.py
│   │       ├── device.py            # @device and @action public contract
│   │       ├── transport.py         # Serial/HTTP/OPC UA/vendor adapter
│   │       ├── simulator.py         # Optional same-contract simulated implementation
│   │       └── assets/              # Device-local tables/models if useful
│   ├── resources/
│   │   ├── __init__.py
│   │   ├── materials.py             # @resource material/consumable templates
│   │   ├── warehouses.py            # Holders, decks, racks, stacks
│   │   └── sites.py                 # Stable Site definitions/bindings
│   ├── workflows/
│   │   ├── __init__.py
│   │   ├── <leaf_workflow>.py
│   │   └── <composite_workflow>.py
│   ├── common/                      # Shared domain adapters, no OS-wide policy
│   ├── config/
│   │   ├── device_instances.yaml
│   │   └── address_tables/          # CSV/JSON/YAML from the field authority
│   └── assets/                      # Icons and 2D/3D models
└── tests/
    ├── conftest.py
    ├── test_registry.py
    ├── test_resources.py
    ├── test_actions.py
    ├── test_workflows_roundtrip.py
    └── test_simulator.py
```

Use a flat import package as the current LabDeviceTemplate does unless the repository has already standardized on `src/`. Do not introduce both layouts.

Small packages can collapse `devices/<device_name>/device.py` to `devices/<device_name>.py`; grow a directory only when the device owns a transport, simulator, address table, or assets.

## 2. `pyproject.toml`

```toml
[build-system]
requires = ["setuptools>=68", "wheel"]
build-backend = "setuptools.build_meta"

[project]
name = "<distribution-name>"
version = "0.1.0"
description = "<laboratory> domain package for UniLab OS"
requires-python = ">=3.11"
dependencies = [
  # Only domain runtime dependencies; pin protocol libraries when compatibility needs it.
]

[project.optional-dependencies]
runtime = ["unilabos"]
dev = ["pytest>=8,<9", "ruff>=0.6"]

[tool.setuptools.packages.find]
include = ["<import_package>*"]

[tool.setuptools.package-data]
<import_package> = [
  "**/*.csv", "**/*.json", "**/*.yaml", "**/*.yml",
  "**/*.xacro", "**/*.urdf", "**/*.stl", "**/*.dae",
  "**/*.obj", "**/*.gltf", "**/*.glb", "**/*.png", "**/*.jpg",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

Use the Python version required by the selected OS/runtime. Avoid declaring the same dependency differently in `requirements.txt` and `pyproject.toml`; if the launcher requires `requirements.txt`, keep it as a minimal compatible projection.

## 3. `package.yaml`

The current domain manifest explicitly registers Workflows:

```yaml
package:
  name: <import_package>

workflows:
  - workflow_uuid: <stable-uuid>
    source: <import_package>/workflows/<workflow>.py
```

The `workflow_uuid` must equal the source decorator value. Add only manifest keys supported by the selected OS; resources and devices are normally discovered from their decorated Python definitions rather than invented manifest sections.

## 4. Device and Action definitions

```python
from typing import TypedDict

from unilabos.registry.decorators import action, device, not_action, topic_config
from unilabos.utils.decorator import subscribe


class MoveResult(TypedDict):
    success: bool
    message: str


@device(
    id="example_device",
    category=["example"],
    displayname="Example device",
    description="A stable device-type contract.",
    icon="icon_device.webp",
    version="1.0.0",
    metadata={"manufacturer": "example"},
)
class ExampleDevice:
    def __init__(
        self,
        device_id: str | None = None,
        config: dict | None = None,
        **kwargs,
    ) -> None:
        """Initialize one configured device instance.

        Args:
            device_id[Device ID]: Stable configured instance ID.
            config[Device configuration]: Transport and site-specific configuration.
        """
        self.device_id = device_id or "example_device"
        self.config = config or {}

    @action(description="Move material")
    def move(self, target: str) -> MoveResult:
        """Move to a named target.

        Args:
            target[Target]: A validated business target, not a raw PLC address.
        """
        self._transport_move(target)
        return {"success": True, "message": "completed"}

    @action(description="Read health", always_free=True)
    def read_health(self) -> str:
        """Read health without acquiring the mutating-action lock."""
        return "ready"

    @property
    @topic_config(1.0)
    def status(self) -> str:
        """Published device status."""
        return "idle"

    @subscribe(device_id="upstream_device", status_name="status")
    def on_upstream_status(self, value) -> None:
        """Receive another device's status; do not subscribe to self."""
        self._upstream_status = value

    @not_action
    def connect(self) -> None:
        """Public lifecycle helper that must not enter the Action Catalog."""
        ...

    def _transport_move(self, target: str) -> None:
        ...
```

Important details:

- `category` is required by the current `@device` contract.
- New code uses `displayname`; `display_name` remains a compatibility alias in some OS versions.
- `@action()` infers the typed contract from the signature. Keep `handles` as a compatibility assertion or for an active legacy/UI need, not a competing truth.
- Docstring parameters use `name[Title]: description`; defaults live in the signature.
- Prefer `@action(always_free=True)` over stacking the older standalone `@always_free` decorator.
- The `@subscribe` import currently comes from `unilabos.utils.decorator`. If `msg_type` should be auto-detected from the ROS graph, do not add a misleading built-in callback annotation.
- Current Action options vary by OS revision. Do not copy `timeout`, approval, or draft error-policy fields from a roadmap document without checking the installed signature.

## 5. Resources and material-aware Actions

```python
from typing import Annotated, TypedDict

from pydantic import Field
from unilabos.registry.annotations import AllowedResourceTemplates
from unilabos.registry.decorators import action, resource
from unilabos.registry.placeholder_type import ResourceSlot


@resource(
    id="sample_container",
    category=["consumable"],
    displayname="Sample container",
    description="Replace with the actual resource geometry and Sites.",
    version="1.0.0",
    class_type="pylabrobot",
)
class SampleContainer:
    """Registered resource template."""


class ProcessResult(TypedDict):
    sample: ResourceSlot
    message: str


class Processor:
    @action(description="Process sample")
    def process(
        self,
        sample: Annotated[
            ResourceSlot,
            AllowedResourceTemplates(SampleContainer),
            Field(description="The same sample container passed through this Action"),
        ],
    ) -> ProcessResult:
        return {"sample": sample, "message": "completed"}
```

Use actual framework resource bases/factories when the selected geometry library requires them; the decorator example shows the registry contract, not a complete physical resource implementation. Stable Site definitions and inventory instances remain laboratory data.

## 6. Workflow definition

Keep Workflow imports separate from registry decorators. This compact shape is enough here; input/output, material, grouping, and round-trip details live in [workflow-python-contract.md](workflow-python-contract.md).

```python
from unilabos.registry.placeholder_type import ResourceSlot
from unilabos.workflow.authoring import device, workflow

from <import_package>.devices.example.device import ExampleDevice

station: ExampleDevice = device()

@workflow(
    workflow_uuid="<stable-uuid>",
    displayname="Example workflow",
    description="One material-aware vertical slice.",
)
def example_workflow(*, sample: ResourceSlot) -> WorkflowResult:
    # unilab:node_uuid=<stable-node-uuid>
    processed = station.process(sample=sample)
    return {"sample": processed.sample, "message": processed.message}
```

Define `WorkflowResult` as a named `TypedDict` or frozen dataclass, and add `AllowedResourceTemplates` metadata when the material template is known. Read the linked Workflow reference before adding MaterialSource, groups, parallel branches, composites, start points, disabled nodes, or graph editing.

## 7. Simulator counterpart

Use the same public contract for real and simulated implementations:

- identical device type or declared pairing identity according to the active OS;
- identical Action names, parameter types/defaults, result schemas, and topics;
- deterministic state progression and failure injection in the simulator;
- no real transport calls in simulation;
- the same Workflow and Workbench UI must run without rewriting device symbols.

The pairing configuration described in planning documents may not yet be present in the selected OS. Discover the active mechanism before creating `device_pair.yaml` or adding a `--sim_engine` argument.

## 8. CI and acceptance

At minimum:

```bash
python -m pip install -e '.[dev]'
unilab --check_mode --devices ./<import_package> --external_devices_only
pytest -q
```

CI should verify:

- editable install and import from a clean checkout;
- static registry scan and generated schemas;
- stable resource/Site definitions;
- Action real/simulator contract parity;
- Workflow manifest/decorator UUID agreement;
- Python/graph/Python round-trip for authored Workflows;
- representative simulated Action and Workflow behavior.

Do not require network hardware or a laboratory PLC in ordinary CI. Record physical acceptance separately.
