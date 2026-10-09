# Material 业务组件

预留给物料、库位及其关系的业务语义组件。组件应接收 `@unilab-fe/core` 的模型或视图模型，不直接拥有物料图状态。

- `MaterialInspector`：基于 `MaterialInspectionProjection` 展示物料事实，并通过稳定 id 回调库位和占用物料选择。
- `MaterialSitePresentation`：复用库位、占用关系和空状态展示；不读取 query、capability 或 command。
- `SitePicker`：单独的库位列表展示与选择组件。
