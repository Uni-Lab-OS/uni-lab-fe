import styles from './reagent.module.scss'

/**
 * 为独立试剂模块增加局部主题作用域，避免污染物料和工作流界面。
 * @param className 试剂页面的全局业务类名。
 * @returns 同时包含 CSS Module 作用域与业务类名的 className。
 */
export function reagentScopeClassName(className: string): string {
  return `${styles.scope} ${className}`
}
