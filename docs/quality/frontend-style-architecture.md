# 前端样式分层规范

## 决策顺序

新增或修改界面时，按以下顺序选择样式方案：

1. **Tailwind 优先**：布局、间距、尺寸、排版、颜色、边框、常规 hover/focus 和响应式断点直接写在 JSX 中。样式与结构一一对应时，不再创建选择器。
2. **CSS Module SCSS 承接复杂关系**：伪元素、复杂层叠、第三方 DOM、Canvas/React Flow/Pascal 覆盖、组合状态、动画关键帧，以及重复使用且 Tailwind 表达明显降低可读性的规则，放入 `*.module.scss`。
3. **普通 CSS 仅用于全局边界**：设计令牌、应用 reset/壳层、第三方宿主、跨 React/Theia 的公开样式合同和独立 HTML 文档可以使用 `.css`。业务组件不得新建普通 CSS。

SCSS 拆分文件以 `_` 开头，并由同一应用或包内的 `*.module.scss` 入口组合；组件只能导入 Module 入口，不能直接依赖 partial。不要用 `!important` 修复所有权不清或选择器权重问题。

## 当前普通 CSS 白名单

下列目录或文件属于明确的全局/宿主边界：

- `apps/kernel-web/src/styles/global.css` 与 `global/`：Web 应用 reset、登录、应用壳及跨面板组合规则。
- `apps/workbench/desktop/welcome.css`：独立欢迎页文档。
- `packages/design-system/src/theme.css`：全局设计令牌与主题变量。
- `packages/material/src/UnifiedMaterialViewport.css`：React 与 Theia 共同消费的公开 viewport 合同。
- `packages/pascal-host/src/styles/`：Pascal/Tailwind 宿主入口和第三方主题桥。
- `packages/workbench-theia/src/browser/style/`：Theia 平台与第三方 DOM 集成。
- `e2e/*.css`：测试 fixture 文档。

普通 CSS 白名单不是业务样式的落点。需要新增白名单时，应在评审中说明为什么该规则必须跨模块或跨宿主生效。

## 存量清理结果

- 设备管理原有 `DeviceManagement.css` 与 `DeviceManagementActions.css` 已迁入 CSS Module，组件不再向应用注入 `section__*`、`device-list__*` 等通用类名。
- Web 全局样式中无引用的旧设备页与 `ptlc-*` 规则已删除；设备分栏、空态和移动端规则现在由设备管理模块拥有。
- Workbench/Theia 是机械臂工站能力的正式验收宿主；动作调试、点位管理、实验台、试剂管理分别占用左侧活动栏一级入口，业务主区不再创建第二层侧边栏或顶部模块导航。`apps/workbench` 构建链直接加载业务包的 CSS Module，Kernel Web 不保留机械臂工站入口。
- 物料、工作流、机械臂工作站及其他业务组件已经使用 `*.module.scss` 入口；大文件可继续拆为 Module partial，但不能变回普通 CSS。
- Theia、Pascal、Material viewport、设计令牌和独立欢迎页保留普通 CSS，因为它们分别承担平台、第三方或公开样式合同。

运行 `pnpm quality:styles` 可检查新增普通 CSS、无 Module 入口的 SCSS partial、设备管理全局类回退，以及已收口业务模块中的 `!important`。
