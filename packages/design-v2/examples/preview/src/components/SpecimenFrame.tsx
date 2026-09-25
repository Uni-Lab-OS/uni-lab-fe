import type { ComponentSpec } from './componentRegistry'

type SpecimenFrameProps = {
  component: ComponentSpec
  children: React.ReactNode
}

export function SpecimenFrame({ component, children }: SpecimenFrameProps): React.JSX.Element {
  return (
    <article className="specimen-page" id={`component-${component.id}`}>
      <header className="specimen-page-header">
        <div>
          <span className="eyebrow">{component.group.toUpperCase()} / {component.antDesign}</span>
          <h2>{component.name}</h2>
          <p className="specimen-lede">设计页逐项审计入口。示例仅消费 design-v2 语义变量，不在此处扩展组件库。</p>
        </div>
        <div className="specimen-status" data-status={component.designReview}>
          <span className="status-dot" />
          <strong>{component.designReview === 'pending-right-panel' ? '待右栏核验' : component.designReview === 'design-node-missing' ? '设计节点缺失' : component.designReview === 'aligned' ? '已对齐' : '已读右栏 / 待视觉对齐'}</strong>
          <span>{component.implementation === 'antd' ? 'AntD 对应实现' : 'Example 演示外壳'}</span>
        </div>
      </header>
      <div className="audit-strip" aria-label="component audit metadata">
        <span><b>状态</b> {component.states.join(' · ')}</span>
        <span><b>尺寸</b> {component.sizes.join(' · ')}</span>
        <span><b>变量</b> {component.variableBinding}</span>
      </div>
      <section className="specimen-canvas" aria-label={`${component.name} demo`}>
        {children}
      </section>
      <p className="design-note"><b>设计来源：</b>{component.designNode}。Figma 右侧样式、状态和变量说明读取后，才能将本页标记为对齐。</p>
    </article>
  )
}
