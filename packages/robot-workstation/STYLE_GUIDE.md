# 样式分层原则

机械臂工作站采用 Tailwind、CSS Module SCSS 和全局 CSS 三层样式边界，选择顺序如下。

1. **优先使用 Tailwind。** 单个元素能够通过原子类清楚表达的布局、间距、尺寸、排版、颜色、基础交互状态和简单断点，直接写 Tailwind。跨文件重复的按钮、标签和面板原子类集中在 `src/uiClasses.ts`，类名必须保持静态可扫描，禁止动态拼接 Tailwind token。
2. **复杂的组件局部样式放在 `*.module.scss`。** 需要父子/兄弟关系、`data-*` 或 ARIA 状态、表格与画布投影、复杂网格、伪元素、多阶段交互以及成组响应式重排时，使用 CSS Module SCSS。选择器只能影响当前组件，不使用全局类名。
3. **全局基础样式才放普通 CSS。** 机械臂工作站的正式宿主是 Workbench/Theia；reset、设计 token 接入、应用壳层、第三方库覆盖和无法模块化的 renderer 级规则进入 `packages/workbench-theia/src/browser/style/*.css`。业务模块不得把局部视觉规则写入宿主全局 CSS，也不新增 `!important` 争夺优先级。

补充约束：`packages/robot-workstation` 只向 Workbench 暴露业务组件，不拥有第二套侧边栏；四个功能模块通过主区顶部标签切换。优先复用 `@unilab/design-system` 的 CSS 变量；同一视觉事实只保留一个来源；迁移 Tailwind 后同步删除失效的 SCSS 和响应式选择器；颜色状态必须同时有文字或可访问语义，不能只靠颜色表达。
