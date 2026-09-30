import sharedStyles from './taskDetail.module.scss'
import pageStyles from './TaskDetailPage.module.scss'
import inspectorStyles from './TaskDetailInspector.module.scss'
import parallelStyles from './TaskParallelDrawer.module.scss'

const styleMaps = [sharedStyles, pageStyles, inspectorStyles, parallelStyles]

/**
 * Resolve task-detail classes without making the feature depend on the app-wide
 * style map. Unknown classes are preserved for third-party/runtime styles.
 */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter((name): name is string => Boolean(name))
    .flatMap((name) => name.split(/\s+/))
    .filter(Boolean)
    .flatMap((name) => {
      const resolved = styleMaps.flatMap((styles) => (styles[name] ? [styles[name]] : []))
      return resolved.length > 0 ? resolved : [name]
    })
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(' ')
}
