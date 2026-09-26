# design-v2 icon workflow

本目录的 icon 集合来自 Figma Bohr Design System 的只读导出。新增或更新 icon 时，不要手工编辑 `src/icons/generated`、`src/icons/static` 或复制 SVG body 到业务代码。

## 唯一同步命令

先从 Figma 导出完整的公开 icon 集合，并整理为“按分类分目录”的 SVG：

```text
<export>/clean/<Figma category>/<Figma icon name>.svg
```

然后执行：

```bash
pnpm --dir packages/design-v2 icons:sync -- \
  --source-dir /path/to/figma-export/clean
```

`icons:sync` 会依次执行 `build-icon-assets.mjs` 和 `validate-icons.mjs`，自动完成：

- SVG 主题化：`#1D2129` → `currentColor`；
- Figma provenance 和 manifest 更新；
- 分类懒加载 chunk 生成；
- 单图标 static 入口生成；
- 资产、类型、Deprecated、硬编码颜色和数量一致性校验。

它是完整快照重建命令，输入必须包含完整公开集合，不能只放一个新增 SVG。生成器会清理并重建 `src/icons/assets`、`src/icons/generated` 和 `src/icons/static`，这是为了避免删除或重命名后留下孤儿文件。

## 同步后的固定检查

```bash
pnpm --dir packages/design-v2 typecheck
pnpm --dir packages/design-v2/examples/preview typecheck
pnpm --dir packages/design-v2/examples/preview build
git diff --check -- packages/design-v2
```

预览页地址是 `http://localhost:5173/#icons`。用它搜索新图标，确认分类、名称、主题色和显示结果。

## AI agent 规则

1. 先从 Figma 导出或拿到完整 `<export>/clean` 目录，不要根据语义猜名称或重新绘制 SVG。
2. 只执行 `icons:sync` 生成产物；不要编辑 generated/static 文件。
3. 业务代码使用 `@unilab/design-v2/icons` 的 `Icon` 或 static 入口，不复制 SVG body。
4. 完成四个固定检查后，报告 manifest 中新增/删除/重命名的 icon 数量，并把预览核验结果写入变更说明。
5. 当前仓库不自动读取 Figma 个人登录态；如果没有新的导出目录，先说明阻塞原因，不要凭经验补图标。

如需冻结某个发布分支的数量，可额外运行：

```bash
pnpm --dir packages/design-v2 icons:sync -- \
  --source-dir /path/to/figma-export/clean \
  --expected-count 1227
```
