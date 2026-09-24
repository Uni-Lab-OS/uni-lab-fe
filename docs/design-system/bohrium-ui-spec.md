# Bohrium UI 规范（Uni-Lab 新版）

> 来源：Bohrium Design System 1.0.0 Figma 稿。本文只描述新设计系统的目标规范，不复用或扩展现有 `packages/design-system`。

## 1. 设计系统定位

- 以 token 为唯一视觉事实源，组件只消费语义 token。
- 组件需要同时支持 Light / Dark 两个 Color Mode；切换模式不修改业务组件代码。
- CSS 命名和 Tailwind utility 保持可映射，兼容 shadcn/ui 的基础变量命名。
- 业务组件优先使用 `Bohrium Semantic Colors`，禁止直接引用 Primitive Color。
- Primitive、Theme、Semantic、Compatibility 四层职责分离，避免业务层出现颜色值和重复主题逻辑。

## 2. Figma 变量集合

设计稿说明当前文件包含 6 个本地变量集合：

1. **Foundation**：基础尺寸、间距、边框、透明度、行高，以及 Bohrium Primitive Color。
2. **Theme**：字体、字号、行高、字重、字间距、段落属性、圆角、容器、断点、阴影和聚焦效果等排版/效果基础 token。当前只有 Default Mode，不承担颜色主题。
3. **Color Modes**：Light / Dark 两种模式，承载 Bohrium Semantic Colors，以及 `base`、`alpha`、`custom` 等 shadcn/ui / Tailwind 兼容变量。
4. **Responsive / Pro 扩展**：响应式和 Pro 场景的扩展变量。
5. **图标库显示控制**：图标库的展示/筛选控制变量。
6. **图标上下文颜色**：图标随上下文变化时使用的颜色变量。

### Foundation token

稿件中明确出现的基础 token 类别：

| 类别 | 作用 | Tailwind 映射示例 |
| --- | --- | --- |
| `spacing` | 组件/框架内边距、外边距和间距 | `spacing/4` → `p-4` |
| `width` / `min-width` / `max-width` | 组件和容器宽度限制 | `w-32`、`min-w-3xs`、`max-w-3xl` |
| `height` | 组件和元素高度 | `h-3` |
| `breakpoint` | 响应式断点 | `breakpoint/sm` → `sm:*` |
| `border-radius` | 元素圆角 | `border-radius/rounded-lg` → `rounded-lg` |
| `border-width` | 边框粗细 | `border-width/border-2` → `border-2` |
| `stroke-width` | 图标描边宽度 | 统一图标描边，不逐图标硬编码 |
| `opacity` | 透明度 | `opacity/opacity-70` → `opacity-70` |
| `line-height` | 文本行高 | `line-height/leading-6` → `leading-6` |
| `Bohrium Primitive Color` | Semantic Colors 的基础色值 | 仅供语义层引用 |

业务组件的颜色应优先引用 Semantic Colors，不直接引用 Primitive Color。

### Theme token

Theme 集合用于：

- 创建和维护 Typography Styles；
- 定义 Effect Styles（如 Shadow / Focus）；
- 统一管理圆角、容器宽度和响应式断点；
- 提供稳定的排版与效果基础 token。

Typography 的开发映射遵循稿件示例：

```html
<h1 class="font-sans text-4xl font-extrabold line-height-text-4xl">
  Heading Example
</h1>
```

在 Figma 中创建样式时，先选用 Theme 集合变量，再建立 Typography Style；开发侧使用对应的 Tailwind class，保持设计和代码一致。

## 3. Color Modes 与语义颜色

### 3.1 变量优先级

新建或维护 Bohrium 组件时按以下顺序选变量：

1. `Color Modes / Bohrium Semantic Colors`：业务组件默认选择。
2. `base`：仅用于保留 shadcn/ui Base 颜色变量和 Tailwind 类名映射。
3. `alpha`：仅用于透明度组合。
4. `custom`：仅用于 Bohrium Semantic Colors 无法表达的 Light / Dark 特殊兼容场景。

### 3.2 语义颜色命名

Light / Dark 模式都必须提供同名 token；组件不感知具体色值。

| Token | 语义 |
| --- | --- |
| `background` / `foreground` | 应用背景、背景上的主要文本/图标 |
| `card` / `card-foreground` | 卡片背景、卡片文本/图标 |
| `popover` / `popover-foreground` | 下拉菜单和 Popover 背景、内容 |
| `primary` / `primary-foreground` | 主品牌操作色、其上的文本/图标 |
| `secondary` / `secondary-foreground` | 次级操作色、其上的文本/图标 |
| `muted` / `muted-foreground` | 弱化背景、说明文字和标签 |
| `accent` / `accent-foreground` | 激活/聚焦强调色、其上的文本/图标 |
| `destructive` / `destructive-foreground` | 错误和删除操作、危险内容文本/图标 |
| `border` | 默认边框 |
| `input` | 表单输入框和按钮边框 |
| `ring` / `ring-offset` | Focus 指示色、元素与 Ring 外轮廓之间的颜色 |
| `chart-1` … `chart-5` | 数据可视化序列颜色 |
| `sidebar` / `sidebar-foreground` | 侧边栏背景、文本/图标 |
| `sidebar-primary` / `sidebar-primary-foreground` | 侧边栏主要操作及其文本 |
| `sidebar-accent` / `sidebar-accent-foreground` | 侧边栏高亮及其文本 |
| `sidebar-border` / `sidebar-ring` | 侧边栏分隔/边框、Focus 指示 |

稿件还给出少量兼容示例，如深色模式的 `background dark:input/30`、`accent dark:input/50`。这类变量放在 Compatibility 层，不作为业务组件默认 API。

### 3.3 模式切换行为

设计稿中的使用流程是：选择 Page / Frame → 在右侧面板找到 Mode → 切换 `Light` 或 `Dark` → 检查组件的颜色、边框、文本和状态是否同步切换。

Web 实现应将模式挂在应用根节点（推荐 `<html data-theme="light|dark">`），并通过 CSS variables 完成切换，同时设置 `color-scheme`。组件只使用 `var(--bh-*)` 语义变量或其 Tailwind 映射，不在组件内维护一套 `dark:` 重复值。

## 4. 新包建议

建议新建独立包 `packages/design-v2`，包名为 `@unilab/design-v2`，不修改旧包。
第一阶段只提供 CSS token、主题变量、默认风格和框架适配，不开发 React UI 组件。

推荐结构：

```text
packages/design-v2/
  src/
    tokens/
      foundation.css
      theme.css
      color-modes.css
      compatibility.css
      icons.css
    themes/
      default.css
    adapters/
      tailwind.css
      antd.css
    runtime/
      theme.ts
    index.ts
  tokens/                 # 可选：Canonical JSON/TS，生成 CSS 与类型
  package.json
```

实现约束：

- Canonical token 只维护一份，再生成 CSS variables、Tailwind preset 和 TypeScript 类型。
- 核心包不依赖 React、AntD 或 Tailwind，外部项目可以只使用 CSS variables。
- 对外导出 `core.css`、`themes/default.css`、`adapters/tailwind.css`、`adapters/antd.css` 和 token 类型/读取 API。
- 主题运行时提供无框架的 `setTheme` / `getTheme` / `watchTheme`；React 封装不是第一阶段目标。
- Tailwind 4 通过 CSS `@theme` 映射语义变量；AntD 通过独立适配层或 ConfigProvider 配置接入，不污染核心 token。
- 外部项目可以只引入核心 token，也可以引入 Bohrium 默认主题；自定义主题只需覆盖同名 CSS variables。
- 业务代码不得直接引用 `tokens/foundation.css` 中的具体颜色值。

## 5. 后续组件规范（暂不实现）

Figma 的组件页和主题预览页需要在可交互/可放大条件下逐个抽取，但本阶段只记录规范，不实现组件库。后续每个组件应形成固定记录：

- 组件名、用途与组合关系；
- size、variant、状态矩阵；
- 内外间距、圆角、边框、阴影和图标尺寸；
- Light / Dark 下的语义 token 映射；
- 键盘交互、Focus Ring、禁用态和无障碍名称；
- 对应的 React API、Tailwind class 与视觉回归用例。

首批建议优先记录 App Shell、Button、Input、Select、Textarea、Checkbox、Radio、Switch、Badge、Card、Dialog、Popover、Tooltip、Tabs、Table、Toast、Alert、Progress、Skeleton、Sidebar 和数据图表容器。

## 6. 落地顺序

1. 冻结旧 `packages/design-system`，建立 `packages/design-v2` 和 token 构建链。
2. 完成 Foundation、Theme、Color Modes 和 Bohrium 默认主题。
3. 完成无框架主题 runtime，以及 Tailwind 4 / AntD 适配层。
4. 建立一个最小主题预览页，用 Light / Dark 和自定义主题验证变量覆盖、组件生态兼容性。
5. 设计系统基础层稳定后，再单独评估是否需要开发 React UI 组件库。
