import type { DeviceFilters as Filters } from './deviceFilterModel'
import styles from './DeviceFilters.module.scss'

export function DeviceFilters({ value, onChange, locksKnown, visibleCount, totalCount }: {
  value: Filters
  onChange: (filters: Filters) => void
  locksKnown: boolean
  visibleCount: number
  totalCount: number
}): React.JSX.Element {
  const filtered = value.query !== '' || value.status !== 'all' || value.lock !== 'all'
  return (
    <div className={styles.filters} role="search" aria-label="查找仪器设备">
      <label>
        <span>搜索仪器</span>
        <input
          type="search"
          placeholder="名称、标识或动作"
          value={value.query}
          onChange={(event) => onChange({ ...value, query: event.target.value })}
        />
      </label>
      <div className={styles.selects}>
        <label>
          <span>在线状态</span>
          <select value={value.status} onChange={(event) => onChange({
            ...value, status: event.target.value as Filters['status']
          })}>
            <option value="all">全部状态</option>
            <option value="online">在线</option>
            <option value="registered">已注册，未连接</option>
            <option value="offline">离线</option>
          </select>
        </label>
        <label>
          <span>锁定状态</span>
          <select
            value={value.lock}
            disabled={!locksKnown}
            title={locksKnown ? undefined : '锁状态尚未就绪'}
            onChange={(event) => onChange({ ...value, lock: event.target.value as Filters['lock'] })}
          >
            <option value="all">全部仪器</option>
            <option value="locked">已锁定</option>
            <option value="unlocked">未锁定</option>
          </select>
        </label>
      </div>
      {filtered ? (
        <div className={styles.summary}>
          <span role="status">显示 {visibleCount} / {totalCount} 台仪器</span>
          <button type="button" onClick={() => onChange({ query: '', status: 'all', lock: 'all' })}>
            清除筛选
          </button>
        </div>
      ) : null}
    </div>
  )
}
