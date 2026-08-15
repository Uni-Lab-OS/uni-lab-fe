# Workflow Python contract

Read this reference when creating or modifying UniLab Workflow Python, Action signatures, material bindings, composite Workflows, graph edits, debugger start/skip behavior, or authoring round-trip code.

This is a concise, laboratory-neutral extraction of the current authoring rules. If the active repository contains a newer Wayfinder decision or normative authoring document, use the newer source and update this reference rather than layering on a local exception.

## 1. Stable source identity

- Prefer one top-level Workflow per source file.
- A Workflow decorator carries a stable `workflow_uuid`, human display name, and optional description.
- The manifest registers the same UUID.
- Function symbol and package-relative source path participate in source identity.
- Keep a stable `# unilab:node_uuid=<uuid>` annotation immediately before each persistent node statement.
- Renaming a function, display label, or moving layout must not casually regenerate stable identities.
- Workflow Python is an AST authoring language; it is not required to execute as an ordinary Python script.

## 2. Action contracts

Only explicit `@action` methods enter the typed Action Catalog.

- Inputs come from parameter names, annotations, and defaults.
- Known materials use `Annotated[ResourceSlot, AllowedResourceTemplates(resource_symbol), ...]`.
- `AllowedResourceTemplates` receives registered Python resource symbols, not UUID strings.
- Closed choices use `Literal[...]`.
- `Field(...)` may carry title, description, and scalar constraints.
- Public Action/Workflow I/O does not use a Pydantic `BaseModel` wrapper.
- Named outputs use `TypedDict` or a frozen dataclass; `-> None` means no explicit output.
- A compatibility `handles=` declaration may assert the inferred contract but cannot become a second source of truth.
- An Action that receives and preserves a material exposes the same material identity on the corresponding output; it does not copy or re-resolve it.

Root Workflow inputs are keyword-only parameters. One parameter represents one stable target Handle. Do not collapse multiple root inputs into a nested input model.

Successful named outputs contain every declared field. Model optional values as `T | None` and return `None` explicitly rather than omitting keys.

## 3. Material sources and Sites

`MaterialSource` is a persistent, non-Action supply boundary. It selects or creates one typed material according to the active catalog and inventory contract.

- Its resource template is a registered resource symbol.
- The mount is an explicit `ResourceSlot` reference.
- Site constraints refer to stable Sites owned directly by the mount and use stable UUIDs on the wire.
- Existing and create-new modes have distinct material-UUID rules.
- Flow role is explicit.
- It does not bind a device, execute movement, or secretly emit another inventory operation.
- Static preview success does not prove runtime reservation/admission behavior.

Task input sends material identity, normally `{"uuid": "<material_uuid>"}`. Inventory authority validates it and freezes the resolved template identity. The frontend must not substitute a template UUID for a material UUID.

Compatible-material selectors query current laboratory inventory and filter by `AllowedResourceTemplates`, mount/Site constraints, and availability. Returning zero entries is valid only when that authoritative intersection is actually empty.

## 4. Structured topology

Use lexical structure to represent topology:

```python
with group("prepare"):
    with parallel():
        left = device_a.run(...)
        right = device_b.run(...)
    joined = device_c.combine(left=left.value, right=right.value)
```

`parallel()` means its direct branches have no source-order dependency. It does not promise simultaneous physical execution. Concrete shared-device locks, material claims, and Site claims remain scheduler/runtime concerns.

Nested `group()` and `parallel()` must be represented recursively. A graph edit that removes a dependency should enlarge, split, or nest real parallel scopes when the resulting graph is representable.

Do not persist topology using:

```python
# unilab:parallelize source_node_uuid=... target_node_uuid=...
with parallel():
    pass
```

Also do not create synthetic no-op Fork/Join nodes for ordinary structured parallelism. A real downstream node with multiple required inputs is the join; if branches must complete without a data consumer, dependency-only edges or Workflow completion semantics carry that requirement according to the active contract.

Not every DAG is series-parallel. If the supported structured language cannot represent the candidate graph, reject the edit with a diagnostic that identifies the conflicting region and suggests restoring an edge or restructuring the source. Never hide the mismatch in comments.

## 5. Material-flow invariants

- Bind each downstream material input to the preceding node's material output.
- A normal material output has at most one physical downstream consumer.
- Split operations create distinct child material identities before branches fan out.
- Multi-material convergence uses separate typed inputs on the real downstream Action.
- Device and Site claims do not replace material dependencies; material edges do not replace claims.
- Position, sample labels, and transport IDs are not substitutes for material identity.

Physical transfer is usually a composite boundary:

```text
physical pick -> physical place -> authoritative inventory transfer
```

The inventory update runs only after the required success witness. Intermediate driver actions should not independently mutate the authoritative material tree.

## 6. Composite Workflows

- A composite child has typed inputs and named outputs.
- A parent consumes the child output rather than bypassing the child and reusing an older handle.
- Catalog scanning discovers dependencies and applies children before parents until it reaches a deterministic fixed point.
- A parent must load after a clean scan; requiring a user to manually open/apply the child first is a catalog defect.
- Missing children, dependency cycles, and incompatible revisions receive distinct diagnostics.

## 7. Debug start, breakpoints, and disabled nodes

Debugger controls change execution state, not authoring topology.

- A breakpoint pauses before its node dispatches; continuing does not duplicate completed work.
- Single-step dispatches the next eligible unit and pauses again after the expected boundary.
- A disabled node is visibly skipped and cannot publish outputs it did not produce.
- Starting after an upstream producer or disabling an intermediate producer creates an input-binding obligation for every required downstream value.
- Bindings may come from Workflow inputs, current inventory selection, or an explicit user-provided literal that satisfies the typed contract.
- Material bindings require current authoritative material identity; never infer them from a previous run merely because a UUID is present in history.
- Branch tests must demonstrate that unrelated ready branches are neither accidentally blocked nor silently skipped.

## 8. Authoring fixed-point requirements

Validate the normalized semantic cycle, not textual equality alone:

```text
source A -> AST A -> graph A -> source B -> AST B -> graph B
```

Require:

- graph A and graph B are semantically equivalent;
- stable Workflow/node identities are preserved;
- typed source/target Handles and material identities are preserved;
- recursive group/parallel structure is expressible and regenerated without hidden directives;
- supported `[title]: description` comments survive normalization;
- source B contains no synthetic empty block or control-comment residue;
- applying source B again is idempotent.

Graph edits must be rejected before source replacement when these invariants cannot be proven.

## 9. Publication checklist

- Manifest and decorator UUIDs match.
- Stable node UUIDs exist and remain stable.
- Every Action and Workflow boundary is statically typed.
- Root inputs are keyword-only; named results use supported records.
- Known materials declare allowed templates.
- Material chains consume prior outputs and do not illegally fan out.
- Parallelism uses structured source, not threads, coroutines, markers, or no-op nodes.
- Composite discovery is child-first and reaches a fixed point on a clean state.
- Catalog, round-trip, conformance, simulation, and representative runtime tests pass at the versions being published.
