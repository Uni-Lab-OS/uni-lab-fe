import { Button, Input } from '@unilab/design-system'

import type { CustomParameter } from '../types'
import { WorkstationIcon } from '../WorkstationIcon'
import styles from '../workstation.module.scss'

/** 提供可增加、编辑和移除的名称/值自定义参数组。 */
export function CustomParameterFields({
  value,
  onChange
}: {
  value: CustomParameter[]
  onChange: (value: CustomParameter[]) => void
}): React.JSX.Element {
  function update(index: number, patch: Partial<CustomParameter>): void {
    onChange(value.map((parameter, parameterIndex) => (parameterIndex === index ? { ...parameter, ...patch } : parameter)))
  }
  if (value.length === 0) {
    return (
      <div className={styles.customParameterAddOnly}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([{ name: '', value: '' }])}
        >
          <WorkstationIcon name="plus" />
          添加自定义参数
        </Button>
      </div>
    )
  }
  return (
    <section className={styles.customParameterFields} aria-label="自定义参数">
      <div className={styles.customParameterHeader}>
        <strong>自定义参数</strong>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...value, { name: '', value: '' }])}
        >
          <WorkstationIcon name="plus" />
          添加参数
        </Button>
      </div>
      <div className={styles.customParameterList}>
        {value.map((parameter, index) => (
          <div className={styles.customParameterRow} key={index}>
            <label>
              <span>名称</span>
              <Input value={parameter.name} onChange={(event) => update(index, { name: event.target.value })} required />
            </label>
            <label>
              <span>值</span>
              <Input value={parameter.value} onChange={(event) => update(index, { value: event.target.value })} required />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="max-[720px]:self-end"
              onClick={() => onChange(value.filter((_item, parameterIndex) => parameterIndex !== index))}
              aria-label={`移除自定义参数 ${index + 1}`}
            >
              <WorkstationIcon name="trash" />
            </Button>
          </div>
        ))}
      </div>
    </section>
  )
}
