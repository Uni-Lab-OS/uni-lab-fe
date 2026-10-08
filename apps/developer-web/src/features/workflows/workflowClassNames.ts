import { cx as resolveAppClassNames } from '../../styles/styleMaps'
import sharedStyles from './WorkflowShared.module.scss'
import listStyles from './WorkflowList.module.scss'
import detailStyles from './WorkflowDetail.module.scss'
import topologyStyles from './WorkflowTopology.module.scss'
import debugStyles from './WorkflowDebug.module.scss'

const styleMaps = [sharedStyles, listStyles, detailStyles, topologyStyles, debugStyles]

/** Resolve workflow feature classes locally before falling back to shared app classes. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter((name): name is string => Boolean(name))
    .flatMap((name) =>
      name
        .split(/\s+/)
        .filter(Boolean)
        .flatMap((token) => [
          ...styleMaps.map((styleMap) => styleMap[token]),
          resolveAppClassNames(token),
          token,
        ]),
    )
    .filter((name): name is string => Boolean(name))
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(' ')
}
