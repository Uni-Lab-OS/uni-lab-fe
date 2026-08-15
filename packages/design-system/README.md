# Design System

`@unilab/design-system` 是 Uni-Lab 视觉 token 和基础组件的唯一来源。基础组件采用
shadcn/ui 的源码所有权模式、Radix 可访问性原语、CVA 变体和 `data-slot` 约定；业务
package 应组合这些原语实现当前 `uni-lab-fe` 画风，主题切换也必须通过语义 token 完成。

## 文件导航

- `src/theme.css`：颜色、间距、圆角、阴影和字体等语义 token。
- `src/components/*`：Button、Input、NativeSelect、Textarea、Badge 和 Dialog 等
  shadcn/ui 风格基础组件。
- `src/lib/utils.ts`：合并调用方类名并消解 Tailwind 冲突的 `cn` 工具。
- `src/SlideOverDrawer.tsx`：通用抽屉组件。
- `src/index.ts`：公共导出。

## 添加组件

仓库根目录已为 `packages/design-system` 和 `apps/kernel-web` 配置 `components.json`。
新增通用组件时从应用目录运行 shadcn CLI，让源码进入 design-system；提交前仍需按
Uni-Lab token、中文可访问文案和现有平台边界复核生成结果。

```bash
cd apps/kernel-web
pnpm dlx shadcn@latest add <component>
```

## 主题规则

- 组件使用 `surface`、`text`、`accent`、`border` 等语义角色，不绑定某个品牌色值。
- theme 是表现配置，不得改变能力、权限或领域状态。
- 业务状态颜色应先定义语义，再映射到主题 token。
- 新组件保持无后端、无 store、无路由依赖。

## 调试器视觉语义

工作流编辑器与调试器必须复用 `theme.css` 中的语义 token，不允许在组件内另写一套
状态色。颜色只用于辅助识别，界面还必须同时提供中文状态文字和可访问标签。

模块识别色仅用于导航、标题、图标和轻量背景，不表达执行状态：设备使用
`--unilab-color-device`，物料使用 `--unilab-color-material`，场景使用
`--unilab-color-scene`，工作流使用 `--unilab-color-workflow`。每个模块必须搭配对应
的 `-soft` token，并保持大面积界面仍以中性色为主。

| 语义 | Token | 用途 |
| --- | --- | --- |
| 主操作 | `--unilab-color-primary` | 开始运行、开始调试、继续等当前主操作 |
| 执行成功 | `--unilab-color-success` | 已成功执行的节点和成功反馈 |
| 正在运行 | `--unilab-color-warning` | 正在运行、等待资源和调试命令处理中 |
| 暂停位置 | `--unilab-color-paused` | 暂停于某节点执行之前 |
| 起始点 | `--unilab-color-start` | 用户选择的本次运行起点 |
| 断点/危险 | `--unilab-color-danger` | 断点、失败、终止和急停 |
| 跳过/排除 | `--unilab-color-skipped` | 起点前、不可达或后端报告跳过的节点 |

“选中节点”使用中性描边和阴影，不复用任何运行状态色。控件圆角以
`--unilab-radius-control` 为基准；布局间距使用 4px 网格；常规状态切换使用
`--unilab-motion-fast` 或 `--unilab-motion-normal`，并尊重系统的减少动态效果设置。

## 界面语言

- 面向用户的标题、按钮、状态、帮助和错误信息默认使用中文。
- JSON、Python、DAG、OS、ID、API 等行业通用缩写和代码标识可以保留英文。
- 原始协议状态或事件名仅作为辅助技术信息展示，不能代替中文主文案。
- 同一动作全局使用同一名称，例如“开始调试”“继续”“单步”“终止”“急停”。

## 绝对不能做

- 不得在业务包各自维护第二套全局 token。
- 不得通过主题切换重建 Material Graph、工作流或服务 Profile。
- 不得让基础组件识别 material、workflow、site 等业务类型。

## 验证

```bash
pnpm --filter @unilab/design-system typecheck
```

视觉变更还要在 kernel-web 和 Electron 中分别检查默认主题与至少一个替代主题。
