# `@unilab/design-v2`

Uni-Lab 新版设计基础层。这个包只负责设计变量、默认主题、主题运行时和技术栈适配，不提供 React UI 组件。

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
