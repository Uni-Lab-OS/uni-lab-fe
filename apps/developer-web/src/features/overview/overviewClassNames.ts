import { cx as resolveAppClassNames } from '../../styles/styleMaps'
import pageStyles from './OverviewPage.module.scss'
import skeletonStyles from './OverviewSkeleton.module.scss'

const styles = { ...pageStyles, ...skeletonStyles }

/**
 * Resolve overview classes while retaining the shared class when a feature
 * style intentionally overrides a shared surface. Without both classes,
 * local selectors such as `.overview-columns` and `.data-section` hide the
 * shared layout/card contract instead of extending it.
 */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter((name): name is string => Boolean(name))
    .flatMap((name) =>
      name
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((token) => [styles[token], resolveAppClassNames(token), token]),
    )
    .filter((name): name is string => Boolean(name))
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(' ')
}
