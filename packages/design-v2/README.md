# `@unilab/design-v2`

Uni-Lab 新版设计基础层。这个包只负责设计变量、默认主题、主题运行时和技术栈适配，不提供 React UI 组件。

如果你只想在新项目里使用这套规范，先看“5 分钟接入”；如果你要继续维护内部 example 规范站或让 AI coding agent 修改组件，直接看“维护与 AI coding agent 约定”。

## 5 分钟接入

一个使用 React + AntD 的新项目只需要完成四件事：

1. 安装 `antd`、`@ant-design/icons` 和 `@unilab/design-v2`。
2. 按固定顺序引入 reset、design-v2 主题和 AntD 适配 CSS。
3. 在应用根部调用 `configureTheme`，并用 `ConfigProvider` 包住应用。
4. 页面直接使用 AntD，业务 CSS 只使用 `--bh-*` 语义变量。

### 入口 CSS

```css
/* src/styles/global.css */
@import 'antd/dist/reset.css';
@import '@unilab/design-v2/core.css';
@import '@unilab/design-v2/themes/default.css';
@import '@unilab/design-v2/adapters/antd.css';

:root {
  font-family: var(--bh-font-family-sans);
  color: var(--bh-color-foreground);
  background: var(--bh-color-background);
}

body {
  margin: 0;
  color: var(--bh-color-foreground);
  background: var(--bh-color-background);
}
```

### 应用根部

```tsx
import { useEffect, useMemo, useState } from 'react'
import { ConfigProvider, theme as antTheme } from 'antd'
import {
  configureTheme,
  createAntdTheme,
  getTheme,
  watchTheme,
} from '@unilab/design-v2'
import './styles/global.css'

configureTheme({ defaultMode: 'system', defaultPreset: 'default' })

export function AppRoot() {
  const [designTheme, setDesignTheme] = useState(getTheme())

  useEffect(() => watchTheme(setDesignTheme), [])

  const antdConfig = useMemo(() => createAntdTheme(designTheme, {
    defaultAlgorithm: antTheme.defaultAlgorithm,
    darkAlgorithm: antTheme.darkAlgorithm,
  }), [designTheme.preset, designTheme.resolvedMode])

  return (
    <ConfigProvider theme={antdConfig}>
      <App />
    </ConfigProvider>
  )
}
```

`createAntdTheme` 已经封装了 design-v2 到 AntD 的 token 映射。业务项目只传入 AntD 自己的算法，不要复制颜色表或重新实现 `getComputedStyle` 读取逻辑。

### 页面组件

```tsx
import { Button, Card, Form, Input, Select, Space } from 'antd'

export function ProjectForm() {
  return (
    <Card title="项目配置">
      <Form layout="vertical">
        <Form.Item label="项目名称" name="name">
          <Input placeholder="请输入项目名称" />
        </Form.Item>
        <Form.Item label="运行环境" name="environment">
          <Select options={[{ label: 'Local', value: 'local' }]} />
        </Form.Item>
        <Space>
          <Button type="primary">保存</Button>
          <Button>取消</Button>
        </Space>
      </Form>
    </Card>
  )
}
```

不需要为每个页面重新设置主色、边框色、输入框背景或 hover/focus 颜色。

## 先理解三层关系

实际使用时不要把所有变量混在一起看。包内变量分成三层：

| 层级 | 命名形式 | 作用 | 业务组件是否直接使用 |
| --- | --- | --- | --- |
| 设计源层 | `--bh-source-*` | 完整保存设计文件中的 Foundation、Theme、Color Modes、Responsive 和 Icon 数值 | 否，通常只用于主题映射 |
| 语义层 | `--bh-*`、`--bh-color-*` | 把原始数值翻译成稳定的产品语义，例如卡片、控件、边框、主色 | 是，业务 CSS 的首选 |
| 组件适配层 | AntD/Tailwind 的变量和选择器 | 把语义层接到具体技术栈的组件样式 | 组件库正常使用即可 |

以卡片为例，完整链路是：

```text
设计源 base/card
  -> --bh-source-color-modes-base-card
  -> --bh-color-card
  -> .ant-card { background: var(--bh-color-card) }
```

因此，页面不应该直接写 `--bh-source-color-modes-base-card`。如果将来替换设计源或增加新的主题，只需要调整默认主题的映射，页面仍然使用稳定的 `--bh-color-card`。

## 安装和 CSS 接入

如果只使用原生 CSS 或 Tailwind，可以不安装 AntD，也不需要 `ConfigProvider`；只引入 `core.css` 和 `themes/default.css` 即可。只有使用 AntD 时才引入 `antd.css` 和 `createAntdTheme`。

只使用基础 token 契约：

```css
@import '@unilab/design-v2/core.css';
```

使用包内默认主题（新项目的推荐起点）：

```css
@import '@unilab/design-v2/core.css';
@import '@unilab/design-v2/themes/default.css';
```

接入 AntD 时，在 AntD 的 reset 之后引入适配层：

```css
@import 'antd/dist/reset.css';
@import '@unilab/design-v2/core.css';
@import '@unilab/design-v2/themes/default.css';
@import '@unilab/design-v2/adapters/antd.css';
```

如果应用使用 AntD `ConfigProvider`，主题 token 映射直接复用包内的 `createAntdTheme`，不需要在业务项目重复维护颜色表。应用只需把 AntD 自己的算法传入：

```tsx
import { useEffect, useMemo, useState } from 'react'
import { ConfigProvider, theme as antTheme } from 'antd'
import {
  createAntdTheme,
  getTheme,
  watchTheme,
} from '@unilab/design-v2'

export function AppRoot() {
  const [designTheme, setDesignTheme] = useState(getTheme())

  useEffect(() => watchTheme(setDesignTheme), [])

  const antdConfig = useMemo(() => createAntdTheme(designTheme, {
    defaultAlgorithm: antTheme.defaultAlgorithm,
    darkAlgorithm: antTheme.darkAlgorithm,
  }), [designTheme.preset, designTheme.resolvedMode])

  return (
    <ConfigProvider theme={antdConfig}>
      <App />
    </ConfigProvider>
  )
}
```

`createAntdTheme` 会读取当前 `--bh-*` 语义变量，并生成 AntD 的 `token` 和主题算法配置。它不依赖 AntD 运行时，因此 `@unilab/design-v2` 仍然只在应用明确接入 AntD 时才需要安装 AntD。

此后直接使用 AntD 组件，不需要给每个组件重新写颜色：

```tsx
import { Button, Card, Input, Select } from 'antd'

export function Panel() {
  return (
    <Card title="项目配置">
      <Input placeholder="输入项目名称" />
      <Select options={[{ label: 'Local / 本地环境', value: 'local' }]} />
      <Button type="primary">保存</Button>
    </Card>
  )
}
```

AntD 适配层只负责覆盖公共外观：卡片、表单控件、下拉面板、按钮、表格、导航、反馈状态等。组件的交互、尺寸 API 和可访问性仍由 AntD 负责。

### 导出入口

| 用途 | 推荐入口 |
| --- | --- |
| 主题运行时、token API、AntD theme bridge | `@unilab/design-v2` |
| 只读取 source token 清单 | `@unilab/design-v2/tokens/source` |
| AntD CSS 适配 | `@unilab/design-v2/adapters/antd.css` |
| AntD theme bridge 子路径 | `@unilab/design-v2/adapters/antd-theme` |
| Tailwind 适配 | `@unilab/design-v2/adapters/tailwind.css` |

`@unilab/design-v2` 不提供 React UI 组件；组件行为、交互和可访问性由 AntD 或业务组件负责。

## 自定义页面样式怎么写

业务 CSS 使用语义变量，不使用设计源变量：

```css
.panel {
  color: var(--bh-color-card-foreground);
  background: var(--bh-color-card);
  border: 1px solid var(--bh-color-border);
  border-radius: var(--bh-radius-lg);
  box-shadow: var(--bh-shadow-sm);
}

.field {
  color: var(--bh-color-control-foreground);
  background: var(--bh-color-control);
}

.primary-action {
  color: var(--bh-color-primary-foreground);
  background: var(--bh-color-primary);
}
```

常用语义变量包括：

| 变量 | 用途 |
| --- | --- |
| `--bh-color-background` / `--bh-color-foreground` | 页面背景和正文 |
| `--bh-color-card` / `--bh-color-card-foreground` | 卡片、面板、弹层容器 |
| `--bh-color-control` / `--bh-color-control-foreground` | 输入框、选择器、默认控件 |
| `--bh-color-control-hover` / `--bh-color-control-active` | 控件悬浮和选中状态 |
| `--bh-color-primary` / `--bh-color-primary-foreground` | 主按钮、选中状态、进度 |
| `--bh-color-border` / `--bh-color-input` | 边框和输入控件边界 |
| `--bh-color-ring` | 聚焦描边 |
| `--bh-color-destructive` | 错误和危险操作 |
| `--bh-color-chart-1` … `--bh-color-chart-5` | 图表序列 |

## Tailwind 4 怎么用

在 Tailwind 入口中引入：

```css
@import '@unilab/design-v2/core.css';
@import '@unilab/design-v2/themes/default.css';
@import '@unilab/design-v2/adapters/tailwind.css';
@import 'tailwindcss';
```

适配层把语义变量注册为 Tailwind theme，因此页面可以使用：

```tsx
<section className="rounded-lg border border-border bg-card p-4 text-card-foreground shadow-sm">
  <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
    创建项目
  </button>
</section>
```

Tailwind 的 `bg-card` 最终仍然读取 `var(--bh-color-card)`，与 AntD 和原生 CSS 共用同一份主题值。

## 主题切换和自定义主题

运行时不依赖 React：

```ts
import { configureTheme, setTheme } from '@unilab/design-v2'

configureTheme({ defaultMode: 'system' })
setTheme({ mode: 'dark' })
```

根节点会得到类似：

```html
<html data-design-preset="default" data-color-mode="dark">
```

应用自己的品牌主题时，保留语义变量名，只覆盖需要改变的值：

```css
:root[data-design-preset='acme'] {
  --bh-color-primary: #0f766e;
  --bh-color-primary-foreground: #ffffff;
  --bh-color-card: #ffffff;
  --bh-color-control: #f4fbfa;
  --bh-color-border: #d9e9e6;
}
```

组件代码不需要知道 `acme` 的具体颜色，也不需要改 AntD 或 Tailwind 的调用方式。

切换主题后不要只依赖 React state 自己改颜色。应通过 `setTheme` 更新根节点属性，再由 `watchTheme` 触发 `ConfigProvider` 重新生成主题：

```tsx
import { getTheme, setTheme } from '@unilab/design-v2'

export function ThemeToggle() {
  const current = getTheme()
  return (
    <button
      onClick={() => setTheme({
        mode: current.resolvedMode === 'dark' ? 'light' : 'dark',
      })}
    >
      切换主题
    </button>
  )
}
```

如果只修改 preset 而不改变明暗模式，`createAntdTheme` 仍然需要重新执行；因此 `useMemo` 应同时依赖 `preset` 和 `resolvedMode`。

## 设计源变量清单

`src/tokens/source.ts` 是只读的机器可读清单；`source.*.css` 是完整的原始变量输出。当前覆盖 6 个集合、共 670 个变量：

| 集合 | 数量 |
| --- | ---: |
| Foundation | 420 |
| Theme | 126 |
| Color Modes | 87 |
| Pro / Responsive | 29 |
| Icon Context | 1 |
| Bohr Icon | 7 |

重新生成 Foundation、Theme 和 Responsive 输出：

```bash
pnpm --filter @unilab/design-v2 generate:source
```

源变量可以通过 TypeScript 辅助函数读取：

```ts
import { sourceCssVar, SOURCE_TOKEN_TOTAL } from '@unilab/design-v2'

const cardSource = sourceCssVar('3. Color Modes/base/card')
// var(--bh-source-color-modes-base-card)
console.log(SOURCE_TOKEN_TOTAL) // 670
```

这个 API 适合做主题工具、可视化或迁移脚本；普通页面和组件仍然应使用语义变量。

## 内部预览页

设计包的网页版说明和消费示例位于 `examples/preview`，不是对外发布的产品应用：

```bash
pnpm --filter @unilab/design-v2-example dev
```

示例同时展示原生 CSS、Tailwind 4、AntD 组件和主题切换如何共享同一套语义变量。

## 维护与 AI coding agent 约定

### 权威顺序

实现或校正组件时，按以下顺序判断，不要把旧 example 样式当作设计依据：

1. Figma File → Components 的组件列表，决定导航顺序和组件名称。
2. 对应组件页面右侧的尺寸、状态、变量绑定和 Selection colors。
3. [`examples/preview/COMPONENT-AUDIT.md`](./examples/preview/COMPONENT-AUDIT.md)，记录已核验、未核验和设计节点缺失。
4. [`examples/preview/src/components/componentRegistry.ts`](./examples/preview/src/components/componentRegistry.ts)，保存页面注册信息和审计状态。
5. `ComponentDemo.tsx` 与预览 CSS，只是当前演示实现，不是设计真相。

如果 Figma 页面没有可选 Components 节点或右侧属性不可读，必须标记为 `design-node-missing` 或待核验，不要推断后标成 `aligned`。

### 修改组件的固定流程

1. 先更新 registry 中的 `states`、`sizes`、`variableBinding` 和 `designNode`。
2. 判断实现类型：有直接 AntD 对应物就使用 AntD；没有对应物时只在 preview 内实现 `example-shell`，不要扩展 UI 组件库。
3. 组件样式优先使用 `--bh-*` 语义变量；只有 Figma 明确给出 source 变量绑定时，才更新主题映射或 adapter。
4. AntD 状态样式优先修正 `ConfigProvider` token；遇到 `.anticon`、SVG、Portal overlay 等内部节点，再在 `antd.css` 或组件局部 CSS 做最小覆盖。
5. Light/Dark 使用站点主题切换的单组渲染，不要在同一页面并排复制两套组件。
6. 每批修改后运行：

   ```bash
   pnpm --dir packages/design-v2 typecheck
   pnpm --dir packages/design-v2/examples/preview typecheck
   pnpm --dir packages/design-v2/examples/preview build
   git diff --check
   ```

7. 用 Ego Lite 打开 `http://localhost:5173/#<component-id>`，至少核对默认、错误/禁用、hover/focus 或设计页明确要求的状态，并在 Light/Dark 间切换一次。
8. 只有右侧说明和 localhost 视觉核验都完成后，才把审计状态标为 `aligned`。

### 变量使用规则

```text
Figma 明确绑定的变量
  -> default.css 的语义映射
  -> createAntdTheme / antd.css / tailwind.css
  -> 页面组件
```

禁止在业务页面：

- 直接使用 `--bh-source-*` 变量作为组件颜色；
- 用 AntD 默认色猜测 Figma 明确绑定的颜色；
- 用 `!important` 在页面里覆盖全局 adapter；
- 为同一个公共 token 在多个业务项目各写一份映射；
- 把 preview 中的 `example-shell` 误当成可复用 UI 组件。

### 当前审计边界

当前审计矩阵包含 68 个导航页面，其中 66 个已完成 Figma 右栏与 localhost 视觉核验；Direction 和 Label 因设计文件缺少可选 Components 节点而保持 `design-node-missing`。这两个页面不能被 AI agent 自动推断为已对齐。
