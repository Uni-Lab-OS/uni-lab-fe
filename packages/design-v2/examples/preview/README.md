# Design v2 Preview 维护说明

这是 `@unilab/design-v2` 的内部规范站，不是对外发布的 React UI 组件库。它的职责是把 Figma File → Components 的审计结果展示出来，并验证 semantic token、AntD adapter 和主题切换。

## 启动

在仓库根目录执行：

```bash
pnpm --dir packages/design-v2/examples/preview dev
```

打开 `http://localhost:5173/`。组件页面使用 hash 路由，例如：

```text
http://localhost:5173/#accordion
http://localhost:5173/#alert-dialog
http://localhost:5173/#rate
```

Icon 集合是独立的首级页面：

```text
http://localhost:5173/#icons
```

Icon 页面使用 `@unilab/design-v2/icons` 的 manifest 做索引，支持按图标名称、Figma 名称或分类搜索，按分类筛选，并切换 Context、Primary、Error 等主题色或输入自定义颜色。首屏只渲染 120 个结果，继续点击 `Load more` 才会追加结果，避免一次性创建全部 1227 个 SVG 节点。

## 代码职责

| 文件 | 职责 |
| --- | --- |
| `src/components/componentRegistry.ts` | 68 个组件的顺序、分组、状态、尺寸、变量绑定和审计状态 |
| `src/components/Sidebar.tsx` | File → Components 左导航 |
| `src/components/IconGallery.tsx` | Icon 集合搜索、分类筛选、主题色和自定义颜色预览 |
| `src/components/SpecimenFrame.tsx` | 页面标题、审计条带、设计来源说明和公共展示框架 |
| `src/components/ComponentDemo.tsx` | 当前演示组件和 example-shell |
| `src/App.tsx` | hash 选择、主题订阅和 AntD `ConfigProvider` |
| `src/styles.css` | 预览页布局和仅限 example 的展示样式 |
| `COMPONENT-AUDIT.md` | Figma/localhost 核验矩阵和证据记录 |

## 新增或校正组件

先读根包 README 的“维护与 AI coding agent 约定”，再按以下顺序修改：

1. 从 Figma File → Components 确认组件顺序和名称。
2. 读取组件页右侧的状态、尺寸、变量和 Selection colors。
3. 更新 `componentRegistry.ts`。
4. 在 `ComponentDemo.tsx` 选择 AntD 对应组件；没有对应物时只写 example-shell。
5. 使用 `--bh-*` 语义变量校正样式，不直接猜测颜色。
6. 更新 `COMPONENT-AUDIT.md` 的证据和状态。
7. 在 Light/Dark 下用 Ego Lite 与 Figma 并排核验。

## 验证

```bash
pnpm --dir packages/design-v2 typecheck
pnpm --dir packages/design-v2/examples/preview typecheck
pnpm --dir packages/design-v2/examples/preview build
git diff --check
```

不要把 preview 中的演示外壳复制到业务项目；业务项目应直接使用 `@unilab/design-v2` 的 CSS、主题运行时、`createAntdTheme` 和 AntD 组件。
