import { SlideOverDrawer } from '@unilab/design-system'

import { useMaterialStore } from './MaterialStoreProvider'
import type { CapabilityStatus } from './MaterialCapabilityNotice'
import { materialScopeClassName } from './materialStyles'
import type { MaterialId } from './types'

export function MaterialInspector({
  materialId,
  updateStatus,
  onClose
}: {
  materialId: MaterialId | null
  updateStatus: CapabilityStatus
  onClose: () => void
}): React.JSX.Element {
  const aggregate = useMaterialStore((state) =>
    materialId ? state.aggregatesById[materialId] : undefined
  )

  return (
    <SlideOverDrawer
      open={materialId !== null}
      title={
        <span
          className={materialScopeClassName(
            'material-inspector__drawer-title'
          )}
        >
          <strong>物料属性</strong>
          {aggregate ? <small>{aggregate.material.name}</small> : null}
        </span>
      }
      ariaLabel="物料属性"
      closeLabel="关闭物料属性"
      onClose={onClose}
      modal={false}
      animated={false}
    >
      <aside
        className={materialScopeClassName('material-inspector')}
      >
        {!aggregate ? (
          <p>选择 2D 或 3D 中的物料查看详情</p>
        ) : (
          <div className="material-inspector__content">
            <div className="material-inspector__identity">
              <span aria-hidden="true">
                <MaterialIdentityIcon />
              </span>
              <div>
                <small>当前物料</small>
                <strong>{aggregate.material.name}</strong>
                <code>{aggregate.material.code || '未设置代码'}</code>
              </div>
            </div>
            <dl>
              <dt>名称</dt>
              <dd>{aggregate.material.name}</dd>
              <dt>代码</dt>
              <dd>{aggregate.material.code || '—'}</dd>
              <dt>模板</dt>
              <dd>{aggregate.material.sourceTemplateId}</dd>
              <dt>放置方式</dt>
              <dd>{placementLabel(aggregate.placement.kind)}</dd>
              <dt>修订版本</dt>
              <dd>{aggregate.revision}</dd>
            </dl>
            <h3>配置</h3>
            <pre>{JSON.stringify(aggregate.material.config, null, 2)}</pre>
            {!updateStatus.available ? (
              <small className="material-inspector__capability">
                {updateStatus.reason}
              </small>
            ) : null}
          </div>
        )}
      </aside>
    </SlideOverDrawer>
  )
}

function MaterialIdentityIcon(): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="m4.5 7.8 7.5 4.3 7.5-4.3M12 12v8.5" />
    </svg>
  )
}

function placementLabel(kind: string): string {
  if (kind === 'world') return '全局坐标'
  if (kind === 'parent') return '父级对象'
  if (kind === 'site') return '安装位'
  return kind
}
