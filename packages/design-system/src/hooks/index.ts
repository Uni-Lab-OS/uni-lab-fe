// shadcn CLI 的 monorepo 约定要求共享 UI workspace 提供稳定 hooks 入口。
// 当前基础组件不需要共享 hook；后续新增时从此处导出，避免业务包自建同名实现。
export {}
