import { materialScopeClassName } from './materialStyles'

/**
 * 展示持久使用记录接口尚未接入时的简洁关闭失败状态。
 * @returns 不伪造使用记录的物料追溯空状态。
 */
export function MaterialUsageHistoryView(): React.JSX.Element {
  return (
    <section
      id="material-view-history"
      className={materialScopeClassName('material-history')}
      role="tabpanel"
      aria-labelledby="material-tab-history"
      aria-label="物料使用记录"
    >
      <header>
        <span aria-hidden="true"><HistoryIcon /></span>
        <div>
          <h3>物料使用记录</h3>
          <p>按实例追溯创建、位置变化、内容变化和工作流使用。</p>
        </div>
      </header>
      <div className="material-history__empty" role="note">
        <strong>使用记录服务尚未接入</strong>
        <p>
          接入后可按物料类型、批次和实例查看创建入库、位置转移、内容消耗和任务使用。
        </p>
        <small>当前不会用浏览器内存生成临时记录。</small>
      </div>
    </section>
  )
}

function HistoryIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M5 8a8 8 0 1 1-1 6M5 8V3M5 8h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}
