# Shared 业务组件

这里承载跨物料、工作流、运行、设备和试剂场景复用的语义组件。纯视觉基础组件继续放在 `@unilab/design-v2`。

- `DefinitionList`：只读领域事实的键值/表单项展示，统一缺失值、宽字段和等宽标识文本。
- `StatusBadge`：状态值到语义色调、文案、图标的映射；领域 adapter 可传入显式 `meta` 覆盖默认映射。
- `SchemaInputField`：按 JSON Schema 渲染受控输入，供 Workflow 和 Device Module 组合使用；校验与提交仍由业务场景负责。

这些组件只接收稳定的展示数据和回调，不读取领域 store、不发起请求，也不绑定 Ant Form。
