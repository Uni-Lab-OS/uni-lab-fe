import { cx as resolveAppClassNames } from '../../styles/styleMaps'
import styles from './ReagentModal.module.scss'

/**
 * Reagent modal 迁移期间的 feature-local class seam；后续样式迁移到
 * ReagentModal.module.scss 后，只需替换这里的映射，不再修改表单组件。
 */
export function cx(...names: Array<string | false | null | undefined>): string {
  return resolveAppClassNames(
    ...names.flatMap((name) =>
      name ? name.split(/\s+/).map((token) => styles[token] || token) : [],
    ),
  )
}
