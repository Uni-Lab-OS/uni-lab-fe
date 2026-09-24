# `@unilab/design-v2`

Uni-Lab 新版设计基础层。第一阶段只提供 CSS token、默认主题、主题运行时和 Tailwind 4 / AntD 适配，不提供 React UI 组件。

## CSS 接入

只使用 token 契约时：

```css
@import '@unilab/design-v2/core.css';
```

使用默认视觉主题时：

```css
@import '@unilab/design-v2/core.css';
@import '@unilab/design-v2/themes/default.css';
```

接入 Tailwind 4 时，再引入：

```css
@import '@unilab/design-v2/adapters/tailwind.css';
```

AntD 适配层需要在 AntD 样式之后引入：

```css
@import '@unilab/design-v2/adapters/antd.css';
```

## 主题运行时

运行时不依赖 React：

```ts
import { configureTheme, setTheme } from '@unilab/design-v2'

configureTheme({ defaultMode: 'system' })
setTheme({ mode: 'dark' })
```

根节点会得到：

```html
<html data-design-preset="default" data-color-mode="dark">
```

`data-theme-mode` 保存用户选择的 `light` / `dark` / `system`，`data-color-mode` 表示当前实际生效的 Light / Dark 值。

自定义主题只需要覆盖 `--bh-*` 变量，并使用自己的 `data-design-preset` 值。

## 语义变量

页面和适配层优先使用语义变量：

```css
.surface {
  color: var(--bh-color-foreground);
  background: var(--bh-color-background);
  border: 1px solid var(--bh-color-border);
}
```

Tailwind 4 适配后可以写成：

```tsx
<section className="rounded-md border border-border bg-card p-4 text-card-foreground">
  内容
</section>
```
