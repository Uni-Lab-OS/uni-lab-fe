# 前端样式归属与覆盖契约

组件分层、`lab-ui` 沉淀门槛、Interface/Seam 以及 TSX 与样式的完整迁移规则，统一以
[前端 Module 边界与 UI 沉淀规范](./frontend-module-boundaries-and-ui-extraction.md) 为准；
本文只补充样式 owner、加载顺序和级联约束。

## 现状审计

| 区域                 | 归属                                        | 当前入口                                                                                                                               | 结论                                                                                                           |
| -------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `packages/core`      | 领域类型、状态和服务契约                    | 无 UI CSS                                                                                                                              | 保持 headless，不引入 Sass、AntD 或主题依赖。                                                                  |
| `packages/design-v2` | token、默认主题、颜色模式、图标和 AntD 适配 | `core.css`、`themes/default.css`、`adapters/antd.css`、图标样式                                                                        | 这些是产品级全局契约，继续全局加载；组件不复制 token。                                                         |
| `packages/lab-ui`    | 可搬运业务组件                              | `shared.module.scss`、`material.module.scss`、`device.module.scss`、`reagent.module.scss`、`run.module.scss`、`workflow.module.scss`   | 每个业务域拥有自己的 Module，组件通过 `cx()` 映射；不再发布全局 `styles.css` 或 `material-inspector.css`。     |
| `apps/developer-web` | 应用壳、页面布局和各页面组件                | `styles/global.css` + `app-shell/overview/devices/materials/reagents/workflows/shared.module.scss`，以及 feature-local `*.module.scss` | 只有 token/reset/AntD 适配保留全局入口；应用壳、表格、资源、工作流、任务详情等样式都由按域拆分的 Module 管理。 |

## 加载顺序

`developer-web/src/main.tsx` 的样式顺序是：

1. design-v2 图标和全局 token/theme；
2. AntD reset；
3. `styleMaps.ts` 汇总各业务域 CSS Module，并由页面组件通过 `cx()` 取对应类名；
4. Module 内部使用 `:global(.ant-*)` 和 `:global(.react-flow-*)` 精确连接第三方运行时类。

`global.css` 只建立 design-v2 token、reset 和 AntD adapter。页面样式不再依赖 import 顺序或一个全站后置覆盖文件；同一元素的视觉规则现在由拥有它的组件 Module 输出。

## 组件约定

- 新的 `lab-ui` 组件只新增自己域内的 `*.module.scss`，组件内通过 `cx('class-name', modifier && 'modifier')` 获取类名。
- 同一个类名只能由一个 Module 定义。`cx()` 会返回所有命中该名字的 Module 类名，
  所以重复定义不会报错，只会退化成“后加载的 Module 覆盖前一个”，让页面样式重新依赖
  import 顺序；总览指标条曾因此同时吃到 `shared` 的整条边框和 `overview` 的卡片圆角。
- 不使用 `className="primary-cell"`、`.history-list` 这类裸类名，也不从 `developer-web` 反向借样式。
- token 和主题变量可以使用全局 CSS 自定义属性；组件结构、间距、状态修饰器必须进入模块文件。
- `core` 不负责视觉；需要 UI 样式时放到 `lab-ui` 或应用层。
- 应用页面样式必须和组件一起放在对应 feature/component 目录或由 `styles` 目录的 Module 导出，不得重新发布为包级全局 CSS。

## 本次修复

- 把 lab-ui 的样式拆到 shared/material/device/reagent/run/workflow 六个 CSS Module，删除包级全局样式入口。
- 给原先依赖 developer-web 的通用类补上 lab-ui 本地样式，避免组件搬运后出现样式丢失。
- 给所有 lab-ui 组件的类名加 CSS Modules 映射，保留状态 modifier 的动态行为。
- 把 developer-web 的 页面 CSS 和覆盖规则迁移为独立 CSS Module，并通过 `styleMaps.ts` 映射组件类名。
- 任务详情试点已完成完整样式收口：`TaskDetailPage`、Inspector、并行抽屉和执行时间线各自位于
  `features/tasks`，通过 feature-local resolver 使用共享交互、页面壳、Inspector、并行抽屉
  和 `TaskExecutionTimeline` 五个 CSS Module；Overview 的调试目标选择器也回收到
  `DebugTargetModal.module.scss`。
- 删除只承载历史任务详情规则的 `styles/tasks.module.scss`，`styleMaps.ts` 不再把任务详情
  样式作为隐式共享 owner；页面组件不再依赖 `classNames` 样式 slot。
- 删除 `body` 的 `min-width: 1024px`，修复窄屏下文档宽度被强行撑开的溢出。

## 验证结果

- `@unilab/lab-ui` typecheck 通过。
- `@unilab/developer-web` typecheck 通过。
- developer-web production build 通过。
- 浏览器检查总览、物料、设备、试剂、工作流和任务页面：真实 backend 数据可加载，布局、空状态、表格和导航正常；开发者日志无 error。
- 窄屏检查确认文档宽度不再超出视口；页面仍以桌面工作台为主，表格在窄屏下保持可读的纵向布局。

## 后续迁移顺序

1. 继续把 `styles` 目录中的 Module 按组件目录下沉，最终让 `PageHeader`、`AsyncState`、表格和各 feature 直接拥有样式文件。
2. 逐步消除 `styleMaps.ts` 的兼容映射，改为每个组件直接 import 自己的 module map。
3. 全局入口只保留 token、reset、图标和第三方 adapter。
