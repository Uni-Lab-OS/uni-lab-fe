# `@unilab/design-v2`

Uni-Lab 新版设计基础层。这个包负责设计变量、默认主题、主题运行时、技术栈适配、Figma Bohr 图标集合和少量跨页面标准组件（当前包含 `EmptyState`）。

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
import { configureTheme, createAntdTheme, getTheme, watchTheme } from '@unilab/design-v2'
import './styles/global.css'

configureTheme({ defaultMode: 'system', defaultPreset: 'default' })

export function AppRoot() {
  const [designTheme, setDesignTheme] = useState(getTheme())

  useEffect(() => watchTheme(setDesignTheme), [])

  const antdConfig = useMemo(
    () =>
      createAntdTheme(designTheme, {
        defaultAlgorithm: antTheme.defaultAlgorithm,
        darkAlgorithm: antTheme.darkAlgorithm,
      }),
    [designTheme.preset, designTheme.resolvedMode],
  )

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

## 空状态 `EmptyState`

`EmptyState` 对齐 Bohrium Design System 的 `Empty / 空状态（补充）` 画板，统一空数据、搜索无结果、网络断开、无权限、任务为空等场景。组件本身是透明的内容容器，卡片背景由外层面板负责；默认规格为宽度 308px、最小高度约 337px、内边距 24px、圆角 12px、纵向间距 16px。

```tsx
import { EmptyState } from '@unilab/design-v2'
;<EmptyState
  scene="no-results"
  illustration={<SearchEmptyIllustration />}
  actions={<Button type="primary">重新搜索</Button>}
/>
```

### 规范

- `scene` 使用稳定的 16 个业务枚举，默认文案来自 `EMPTY_STATE_LABELS`；其中 `no-results` 与 `no-results-2` 是两个独立插画变体，但默认显示文案相同；自定义文案使用 `title`。
- `illustration` 是 `Empty Header` 插槽。当前内置资源直接来自 Figma Empty 画板导出的 SVG：`no-data`、`no-task`、`no-results` 的浅色变体，以及 `no-data` 的深色变体；其他场景可继续通过插槽传入对应的 Figma 变体。
- 插画下方文案统一使用 14px / 24px、字重 500；浅色主题使用 `text/disabled`，深色主题使用 `text/placeholder`。
- `actions` 是 `Empty Content` 插槽，放置标准 Button；没有操作时不要放置空容器。
- `tone="dark"` 用于深色背景，`size="compact"` 用于表格单元格或高度受限的面板。

`EmptyState` 会自动引入自身样式；只使用 CSS 或需要显式引入时，也可以使用 `@unilab/design-v2/empty.css`。

## Figma Bohr 图标

图标来自 [Bohrium Design System 的 Bohr icon 页面](https://www.figma.com/design/SmWwL4eUrBlNQAG6nfWqll/Bohrium-Design-System-1.0.0?node-id=26162-2679&p=f)，以 Figma File 中的 `Icon/<category>/<name>` 组件为权威来源。当前已导出 19 个分类、1227 个公开组件；Deprecated、Pilot、Wrapper 和内部辅助节点不会进入运行时集合。

图标是单独的 React 子路径，不会让只使用 token/CSS 的项目被动引入 React：

```bash
pnpm add @unilab/design-v2 react
```

新项目的全局 CSS 仍然要先接入 token 和默认主题，再接入图标样式；否则 `color="primary"` 等语义色会退回 `currentColor`：

```css
@import '@unilab/design-v2/core.css';
@import '@unilab/design-v2/themes/default.css';
@import '@unilab/design-v2/icons/styles.css';
```

TypeScript 项目还需要由应用提供 `@types/react`；使用 AntD 时继续按上文接入 `antd/dist/reset.css`、`adapters/antd.css` 和 `ConfigProvider`。图标包只提供图形和颜色契约，不替代 AntD 的按钮、菜单或布局组件。

在应用入口引入图标样式，然后直接使用 `Icon`：

```tsx
import { Icon } from '@unilab/design-v2/icons'
import '@unilab/design-v2/icons/styles.css'

export function EmptyState() {
  return (
    <div>
      <Icon name="alerts-feedback/bell-01" size={24} color="context" title="通知" />
      <span>没有通知</span>
    </div>
  )
}
```

放在已有按钮或菜单中、且旁边已经有可见文字时，可以省略 `title`，图标会自动以装饰性 SVG 输出：

```tsx
<button type="button" aria-label="打开设置">
  <Icon name="general/settings-01" size="md" color="inherit" />
</button>
```

`name` 使用小写 kebab-case 的分类和名称，例如 `alerts-feedback/alert-circle`、`finance-ecommerce/credit-card-02`。完整名称、原始 Figma 名称和资产路径可从 manifest 读取：

```ts
import { ICON_CATEGORIES, ICON_MANIFEST, ICON_NAMES } from '@unilab/design-v2/icons'

const alert = ICON_MANIFEST['alerts-feedback/alert-circle']
// alert.figmaName === 'Icon/Alerts & feedback/alert-circle'
console.log(ICON_NAMES.length) // 1227
console.log(ICON_CATEGORIES.map((item) => `${item.name}: ${item.count}`))
```

### 尺寸、颜色和描边

`Icon` 的默认尺寸是 Figma 导出尺寸 24px；也可以传入 8、10、12、14、15、16、18、20、22、24，或 `sm`、`md`、`lg`、`xl`。`color` 表示图标使用的语义颜色角色，会随默认主题和 Light/Dark 切换：

| 属性     | 可选值                                                                  | 语义变量                                                                       |
| -------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `color`  | `context`、`default`、`primary`、`white`、`error`、`success`、`inherit` | `--bh-color-icon-context`、`--bh-color-primary`、`--bh-color-error-default` 等 |
| `weight` | `default`、`strong`、`medium`、`compact`、`detail`、`hairline`          | Figma Bohr Icon 的 1.8、2、1.5、1.2、0.54、0.2 描边组                          |
| `size`   | Figma 的 8–24px 尺寸或设计系统别名                                      | `--bh-icon-size-*` 或显式像素值                                                |

Figma 导出的 `#1D2129` 已转换为 `currentColor`，所以不要在业务 CSS 中重新给 SVG 写黑色。需要跟随父元素颜色时使用 `color="inherit"`；需要明确的主题主色时使用 `color="primary"`。`title` 会生成可访问名称；没有 `title` 的图标默认标记为装饰性图标。

### 生产环境的拆包入口

通用 `Icon` 不会把 1227 个 SVG body 一次性打进应用。它会根据 `name` 的分类前缀按需加载分类 chunk：

```tsx
// 只会在运行时加载 alerts-feedback 分类 chunk
<Icon name="alerts-feedback/bell-01" color="primary" />
```

对首屏、SSR 或 bundle 极度敏感的固定图标，可以使用生成的静态单图标入口：

```tsx
import AlertCircleIcon from '@unilab/design-v2/icons/static/alerts-feedback/alert-circle'
;<AlertCircleIcon size="md" color="error" title="发生错误" />
```

静态入口只包含一个图标 body，可以被 bundler 独立 tree-shaking。图标密集型页面如果已知即将使用某个分类，可以提前预加载：

```ts
import { preloadIconCategory } from '@unilab/design-v2/icons'

void preloadIconCategory('editor')
```

`ICON_MANIFEST`、`ICON_NAMES` 和 `ICON_CATEGORIES` 是搜索/管理用数据，会显式包含完整清单；普通业务页面不需要导入它们。内部 `#icons` 预览页为了支持全量搜索会主动使用完整清单，这是预览行为，不代表生产页面的推荐接入方式。

### 直接使用 SVG 资产

需要 CSS mask 或非 React 页面时，可以从 `@unilab/design-v2/icons/assets/<category>/<name>.svg` 引用同一批导出资产。资产保留 Figma 的路径、mask 和 viewBox，只做了上下文色和 mask 中性底色的主题化处理。需要跟随主题色时优先使用 React `Icon` 或 CSS mask；直接放进 `<img>` 的 SVG 运行在外部文档中，不能可靠继承宿主元素的 `currentColor`。

### 给 AI coding agent 的固定规则

让 agent 新增图标时，要求它按下面顺序处理，不要凭图标语义猜名称或重新画 SVG：

1. 先从 `ICON_NAMES` 中查找候选名称，再用 `ICON_MANIFEST[name].figmaName` 确认 Figma 来源。
2. 页面使用 `<Icon name="..." />`，不要复制 `src/icons/generated` 中的 body，也不要直接写 `#1D2129`。
3. 普通图标默认使用 `color="context"`；品牌强调使用 `primary`，错误/成功使用 `error`/`success`，按钮内图标使用 `inherit` 或 `white`。
4. 只有设计稿明确要求时才设置 `weight`；不要为了“看起来更粗”覆盖 Figma 的特殊细节描边。
5. 变更图标导出后运行 `validate:icons`、design-v2 typecheck 和 preview build；不要手工修改 `generated` 目录。

如果名称无法通过 `IconName` 类型检查，先查 manifest 和预览页搜索结果；不要把 kebab-case 名称改成 PascalCase，也不要退回第三方 icon 包。

### 新增图标的自动化流程

图标的唯一事实来源仍然是 Figma File → Components。当前仓库没有用个人凭证自动读取 Figma 的 API；因此“从 Figma 拉取文件”需要由有权限的设计师或开发者在 Ego Lite/Figma 中执行只读导出。导出完成后，仓库内的整理、主题化、类型入口、按分类拆包和校验都是自动完成的，不需要手工复制 SVG 或编辑 generated 文件。

一次新增或更新图标的标准流程如下：

1. 在 Figma 的 `Icon/<category>/<name>` 下新增或更新公开组件。名称要稳定，不能放在 `Deprecated`、`Pilot`、`Wrapper` 或内部辅助节点中。
2. 从 Figma 只读导出 SVG，并按分类放成 `export/clean/<category>/<name>.svg`。分类目录和文件名来自 Figma，不要自己把名称改成 PascalCase。
3. 运行一键同步命令。它会先清理旧的 `assets`、`generated` 和 `static` 输出，再一次性生成全部图标并校验，避免增量生成留下旧文件：

   ```bash
   pnpm --dir packages/design-v2 icons:sync -- \
     --source-dir /path/to/figma-export/clean \
     --output-dir packages/design-v2/src/icons
   ```

   如果只需要分别执行生成或校验，仍可以使用 `build:icons` 和 `validate:icons`。

4. 运行完整校验和类型/预览构建：

   ```bash
   pnpm --dir packages/design-v2 validate:icons
   pnpm --dir packages/design-v2 typecheck
   pnpm --dir packages/design-v2/examples/preview typecheck
   pnpm --dir packages/design-v2/examples/preview build
   ```

5. 检查 `git diff`：应同时看到 manifest、对应分类 chunk、SVG asset 和单图标 static 入口的变化；不要直接修改这些生成文件。预览页的 `#icons` 搜索可以用来确认名称、分类、主题色和 viewBox。

校验默认允许图标数量变化，因此新增合法图标不会因为旧数量门槛失败；它仍会检查 asset/manifest/static 一一对应、Figma provenance、viewBox、硬编码颜色和 Deprecated 文件。若某个发布分支需要冻结数量，可显式执行 `pnpm --dir packages/design-v2 validate:icons -- --expected-count 1227`，新增图标时再有意更新这个门槛。

如果未来接入 Figma API 或 CI 下载器，只需要让它产出同样的 `export/clean` 目录，然后调用上面的 `icons:sync` 命令；生成器本身不依赖浏览器、Figma SDK 或个人登录态，适合放进 CI。

### 重新生成和校验

重新从 Ego Lite 的只读 Figma 导出结果生成资产时，将解压后按分类整理的目录传给脚本：

```bash
pnpm --dir packages/design-v2 build:icons -- \
  --source-dir /path/to/figma-export/clean \
  --output-dir packages/design-v2/src/icons
pnpm --dir packages/design-v2 validate:icons
```

脚本会同时生成 `src/icons/assets`、`src/icons/generated/manifest.ts`、按分类拆分的 chunk 和 `src/icons/static` 下的单图标入口。校验会检查资产和 manifest 数量是否一致、分类 chunk、静态入口、Figma provenance、原始 viewBox、硬编码颜色以及 Deprecated 文件。不要手工编辑 `generated` 或 `static` 目录；设计稿更新时重新导出并运行生成脚本。

## 先理解三层关系

实际使用时不要把所有变量混在一起看。包内变量分成三层：

| 层级       | 命名形式                     | 作用                                                                         | 业务组件是否直接使用   |
| ---------- | ---------------------------- | ---------------------------------------------------------------------------- | ---------------------- |
| 设计源层   | `--bh-source-*`              | 完整保存设计文件中的 Foundation、Theme、Color Modes、Responsive 和 Icon 数值 | 否，通常只用于主题映射 |
| 语义层     | `--bh-*`、`--bh-color-*`     | 把原始数值翻译成稳定的产品语义，例如卡片、控件、边框、主色                   | 是，业务 CSS 的首选    |
| 组件适配层 | AntD/Tailwind 的变量和选择器 | 把语义层接到具体技术栈的组件样式                                             | 组件库正常使用即可     |

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
import { createAntdTheme, getTheme, watchTheme } from '@unilab/design-v2'

export function AppRoot() {
  const [designTheme, setDesignTheme] = useState(getTheme())

  useEffect(() => watchTheme(setDesignTheme), [])

  const antdConfig = useMemo(
    () =>
      createAntdTheme(designTheme, {
        defaultAlgorithm: antTheme.defaultAlgorithm,
        darkAlgorithm: antTheme.darkAlgorithm,
      }),
    [designTheme.preset, designTheme.resolvedMode],
  )

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

| 用途                                     | 推荐入口                                  |
| ---------------------------------------- | ----------------------------------------- |
| 主题运行时、token API、AntD theme bridge | `@unilab/design-v2`                       |
| 只读取 source token 清单                 | `@unilab/design-v2/tokens/source`         |
| AntD CSS 适配                            | `@unilab/design-v2/adapters/antd.css`     |
| AntD theme bridge 子路径                 | `@unilab/design-v2/adapters/antd-theme`   |
| Tailwind 适配                            | `@unilab/design-v2/adapters/tailwind.css` |

除 `EmptyState` 等明确导出的跨页面标准组件外，组件行为、交互和可访问性仍由 AntD 或业务组件负责。

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

| 变量                                                     | 用途                     |
| -------------------------------------------------------- | ------------------------ |
| `--bh-color-background` / `--bh-color-foreground`        | 页面背景和正文           |
| `--bh-color-card` / `--bh-color-card-foreground`         | 卡片、面板、弹层容器     |
| `--bh-color-control` / `--bh-color-control-foreground`   | 输入框、选择器、默认控件 |
| `--bh-color-control-hover` / `--bh-color-control-active` | 控件悬浮和选中状态       |
| `--bh-color-primary` / `--bh-color-primary-foreground`   | 主按钮、选中状态、进度   |
| `--bh-color-border` / `--bh-color-input`                 | 边框和输入控件边界       |
| `--bh-color-ring`                                        | 聚焦描边                 |
| `--bh-color-destructive`                                 | 错误和危险操作           |
| `--bh-color-chart-1` … `--bh-color-chart-5`              | 图表序列                 |

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
  <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">创建项目</button>
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
<html data-design-preset="default" data-color-mode="dark"></html>
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
      onClick={() =>
        setTheme({
          mode: current.resolvedMode === 'dark' ? 'light' : 'dark',
        })
      }
    >
      切换主题
    </button>
  )
}
```

如果只修改 preset 而不改变明暗模式，`createAntdTheme` 仍然需要重新执行；因此 `useMemo` 应同时依赖 `preset` 和 `resolvedMode`。

## 设计源变量清单

`src/tokens/source.ts` 是只读的机器可读清单；`source.*.css` 是完整的原始变量输出。当前覆盖 6 个集合、共 670 个变量：

| 集合             | 数量 |
| ---------------- | ---: |
| Foundation       |  420 |
| Theme            |  126 |
| Color Modes      |   87 |
| Pro / Responsive |   29 |
| Icon Context     |    1 |
| Bohr Icon        |    7 |

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
