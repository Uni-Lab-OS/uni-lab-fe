/** 来源目录失败不可伪装成引用失效；保留具体原因与明确重读入口。 */
export function MaterialSourceAuthorityNotice({ problem, onRefresh }: {
  problem: string | null
  onRefresh: () => void
}): React.JSX.Element | null {
  if (!problem) return null
  return <div className="persistent-authoring__error" role="alert">
    <strong>物料来源暂不可用</strong>
    <details><summary>查看具体原因</summary><p>{problem}</p></details>
    <button type="button" onClick={onRefresh}>重新读取目录</button>
  </div>
}
