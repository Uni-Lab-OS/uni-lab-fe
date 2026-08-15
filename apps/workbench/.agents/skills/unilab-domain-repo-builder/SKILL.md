---
name: unilab-domain-repo-builder
description: Turn an existing laboratory codebase or device collection into a maintainable UniLab OS domain package, or migrate, diagnose, and validate one. Covers the package directory and manifest, current UniLab decorators, resources and Sites, typed Actions, structured Workflow Python, OS environment discovery, simulator/device parity, Catalog checks, and Workbench E2E. Use whenever a user mentions creating or upgrading a lab-specific UniLab repository, external device package, LabDeviceTemplate-derived repo, driver/workflow migration, or Catalog/round-trip/runtime failures. Do not use for generic Python packaging or OS installation alone.
compatibility: Requires filesystem, shell, Git, and Python. Workbench acceptance additionally needs browser control.
---

# UniLab Domain Repository Builder

Build a laboratory repository as one installable vertical slice: resources and Sites → devices and Actions → leaf Workflows → composites → simulation and Workbench acceptance. Keep laboratory facts here; move only reusable platform semantics into OS or shared frontend packages.

## Start from current evidence

1. Inspect repository instructions, branch/remote/dirty state, manifests, field PRs, address tables, and tests.
2. Resolve the OS from the Python environment that will run the package; never infer it from a sibling directory:

   ```bash
   python -c 'import sys, unilabos; print(sys.executable); print(unilabos.__file__)'
   python -m pip show unilabos
   ```

3. Check decorator signatures against that installed OS. Documentation may include compatibility aliases or not-yet-released options.
4. Preserve user edits and treat approved field data as newer than remembered examples.

## Scaffold the domain package

Start from the current LabDeviceTemplate, then grow it into this layout only as needed:

```text
<repo>/
├── pyproject.toml
├── requirements.txt
├── package.yaml
├── README.md
├── .github/workflows/check_registry.yml
├── <import_package>/
│   ├── __init__.py
│   ├── devices/<device>/device.py
│   ├── resources/{materials,warehouses,sites}.py
│   ├── workflows/<workflow>.py
│   ├── common/
│   ├── config/
│   └── assets/
└── tests/
    ├── test_registry.py
    ├── test_resources.py
    ├── test_actions.py
    ├── test_workflows_roundtrip.py
    └── test_simulator.py
```

Omit empty directories. Keep `package.yaml` at the repository root and register each Workflow UUID against its package-relative source. Include non-Python address tables, models, and configuration as package data.

Before scaffolding or editing decorators, read [references/package-template-and-decorators.md](references/package-template-and-decorators.md). It contains the canonical starter files and current imports.

## Use explicit decorator contracts

Prefer one device per module or small device directory. The minimum idiom is:

```python
from typing import TypedDict

from unilabos.registry.decorators import action, device, not_action, topic_config


class RunResult(TypedDict):
    success: bool
    message: str


@device(
    id="example_station",
    category=["example"],
    displayname="Example station",
    description="Replace with the laboratory device contract.",
)
class ExampleStation:
    @action(description="Run operation")
    def run(self, value: float = 1.0) -> RunResult:
        """Run one operation.

        Args:
            value[Target value]: Device-specific target.
        """
        return {"success": True, "message": "completed"}

    @property
    @topic_config(1.0)
    def status(self) -> str:
        return "idle"

    @not_action
    def connect(self) -> None:
        ...
```

Rules:

- Use canonical `displayname`; `display_name` is compatibility-only where supported.
- Explicitly decorate every public operation with `@action`; use `_private` or `@not_action` for helpers.
- Use `@action(always_free=True)` only for non-mutating reads that must bypass the device lock.
- Put `@topic_config` below `@property`.
- Use `@subscribe` only for another device's state.
- Register materials/consumables with `@resource`; describe compatible material Action inputs with `ResourceSlot` and `AllowedResourceTemplates`.
- Use named `TypedDict` or frozen dataclass results. Let signatures be the source of truth; add explicit handles only when the active compatibility path requires them.
- New decorated definitions should not need a hand-maintained legacy registry YAML.

## Put changes at the correct boundary

| Concern | Owner |
|---|---|
| Resources/Sites, address maps, device config/adapters, Actions, Workflows, domain fixtures | Domain repository |
| Parser/compiler, Catalog dependency scanning, scheduler/execution contracts, inventory authority | Uni-Lab-OS |
| Generic canvas/debugger/environment manager/selectors | Shared frontend package |
| Product shell and branding | Workbench app |

Move behavior downward only when multiple domain packages need the same contract. Never add one laboratory's symbols, UUIDs, or PLC addresses to OS/shared UI.

## Build in dependency order

1. Make packaging/imports and CI executable.
2. Register stable resource templates, physical resources, mounts, Warehouses, and Sites.
3. Register the device class, instance configuration, transport, and optional simulator counterpart.
4. Publish typed Actions and verify their generated schemas.
5. Author and register the smallest leaf Workflow.
6. Scan/apply composite children before parents until Catalog reaches a deterministic fixed point.
7. Add representative simulation and Workbench E2E.

The real and simulated device expose the same Actions, parameter/result types, and topics; only the transport changes. Follow the active OS version's pairing mechanism rather than hard-coding a draft `device_pair.yaml` contract.

## Preserve structured Workflow semantics

Workflow Python is human-owned source and the graph is its projection. For Workflow edits, read [references/workflow-python-contract.md](references/workflow-python-contract.md).

- Use recursive `group()` and `parallel()` structure.
- Preserve stable Workflow/node UUIDs and supported `[title]: description` comments.
- Never persist topology using magic comments, empty `pass` blocks, or no-op Fork/Join nodes.
- Reject a non-representable DAG with an exact diagnostic instead of weakening it.
- Starting after or disabling an upstream producer requires explicit typed input/material binding; never reuse stale runtime identity.

## Validation gates

Run the earliest relevant gate first and do not hide its failure with a later-layer workaround:

1. **Package:** editable install, imports, package data, focused tests.
2. **Registry:** `unilab --check_mode --devices ./<import_package> --external_devices_only`; inspect generated device/Action/resource schemas.
3. **Catalog:** stable IDs, manifest/decorator agreement, clean child-first composite scan.
4. **Authoring:** Python → AST → graph → Python → graph semantic fixed point.
5. **Simulation:** matching address/config revision, real handshake behavior, small Workflow before the longest representative one.
6. **Workbench:** workspace selection, OS lifecycle, edit/save, run, pause/continue/step/stop, logs and graph state through the requested UI path.
7. **Hardware:** separately record physical witness evidence; never describe simulator success as hardware validation.

Use external shell/API probes to diagnose a blocked UI path, but return to Workbench for acceptance when the user requires it.

## Delivery discipline

- Keep domain, OS, and frontend commits in their owning repositories.
- Replace a pushed bad approach with a corrective commit unless history rewriting was explicitly requested.
- Report revisions, changed contracts, gate results, dry-run/simulator/hardware mode, remaining risks, and pushed branch/PR state.
- Do not claim production readiness while packaging, Catalog fixed-point, authoring round-trip, representative E2E, or required hardware evidence is missing.
