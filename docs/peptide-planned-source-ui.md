# planned_load 前端启动合同补齐

2026-09-09，隔离工作区公开 authoring/template/materials graph 的只读响应确认 B（94131da4-7110-57ff-b36f-8b04a2ac1140）含四个 planned_load 来源，使用同一仓库中 cassette_09_layer_05–08 名称范围，material_uuid=null。普通运行 API can_run=true，而前端按钮因来源目录/引用门禁禁用。

三个前端缺口：物料框架 Schema 只接受 existing/create_new；编辑器模式也只接受这两项；范围引用只按 UUID 查找，不能识别新合同允许的挂载点内库位名称。

本批兼容旧两模式/UUID Schema 和新三模式/非空名称 Schema，未知模式仍关闭失败。planned_load 名称仅在指定 mount 的真实兼容 sites 中唯一解析，供 UI 使用稳定 UUID；保存其它字段时保留原合法名称范围。计划来源禁止固定现成 material_uuid，必须有明确目标范围；模板/mount/site 目录缺失和既有来源的物料失效校验保持有效。新增“计划上料”展示与编辑，create_new 兼容保留、语义不混淆。

fixture `packages/services/src/fixtures/peptide-b-material-source.json` 保留真实 B 四来源节点、相关模板/句柄及真实仓库库位身份，省略其它动作节点；空板库存是测试场景，不是写回现场的状态。真实只读原始证据在根 `.local/reset-b-authoring.json`、`reset-b-template.json`、`reset-b-material-graph.json`。

回归经共享启动 guard→WorkflowStartFlow 验证四计划来源可进入读取已应用版本，编辑保存后保持计划模式/原范围/无物料 UUID；反例覆盖目录失效、缺模板/mount/site、重名、错误 mount、existing 缺物料。服务测试用真实新 Schema，加旧 Schema 与未知枚举边界；属性面板测试验证计划说明、隐藏固定物料和禁止无范围。

验证命令：

```powershell
pnpm --filter @unilab/services test src/workflow-material-source.test.ts
pnpm --filter @unilab/workflow-editor test src/utils/workflowPlannedSourceStart.test.ts src/utils/workflowMaterialSource.test.ts src/components/MaterialSourceInspector.test.tsx src/runtime/WorkflowStartFlow.test.ts
pnpm --filter @unilab/services typecheck
pnpm --filter @unilab/workflow-editor typecheck
```

服务 6 项、编辑器 24 项通过，两包 typecheck 通过。日志为根 `.local/fe-planned-source-{services,editor}-{tests,types}.log`。

普通 workspace definition port 的 preflightRun 返回 null 是本批前已有设计：源代码保存/应用后，输入校验通过直接创建标准 WorkflowTask，由 OS 创建/准入门禁处理。正式 Backend port 才调用 normal preflight。本批不扩大此差异，不伪造前端预检通过，也不改运行 API 或后端状态。

## 完整真实目录闭环修正

随后用户仍被阻止启动，完整公共 HTTP 回放定位到目录在进入来源投影前已经失败：`site.meta_data.rotation_deg_xyz` 实际为 `{x,y,z}`，旧 codec 只接受三元素数组。本次严格兼容这两种有限数值形式，不接受缺轴、额外字段、空值或非数值；错误保留具体 site UUID 和字段。

`packages/services/src/fixtures/peptide-b-full-http.json.gz` 保存隔离 Backend 的 9 路完整只读 HTTP 响应（含全部 sites metadata），解压后 2,487,397 字节，SHA256 为 `d80cfd7bccb85f9441a09d1e3b295e8f566c8e31a2f0b7326aca7e1e248d4660`。回归经公开 `createMaterialService` → `createWorkflowRuntime` → 完整 B authoring → 实际来源 guard，覆盖 66 个物料、201 个库位、44 个节点及 4 个来源；不再依靠精简来源 fixture 验证目录加载。破坏实际库位旋转字段的反例继续阻止启动，并保留原始原因。

真实 GET 闭环同样通过，证据为根 `.local/reset-b-full-public-services-live.log`；原始失败为 `.local/reset-b-full-probe.log`。界面提供“查看具体原因”和“重新读取目录”，不再将目录解析异常泛化为引用失效。

```powershell
pnpm --filter @unilab/services test src/materials.test.ts src/workflow-material-source.test.ts src/materialBackendGraphCodec.test.ts
pnpm --filter @unilab/workflow-editor test src/utils/workflowFullCatalog.test.ts src/components/MaterialSourceAuthorityNotice.test.tsx src/utils/workflowPlannedSourceStart.test.ts
pnpm --filter @unilab/services typecheck
pnpm --filter @unilab/workflow-editor typecheck
```

服务 21 项、编辑器 6 项通过，两包 typecheck 通过。日志为根 `.local/fe-full-catalog-services-tests.log`、`fe-full-catalog-tests.log`、`fe-full-catalog-services-types.log`、`fe-full-catalog-editor-types.log`。本批不改变物料流连线或后端库存。
