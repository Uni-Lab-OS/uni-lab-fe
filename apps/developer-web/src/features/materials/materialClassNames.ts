import { cx as resolveAppClassNames } from '../../styles/styleMaps'
import pageStyles from './MaterialsPage.module.scss'
import flowStyles from './MaterialFlowCanvas.module.scss'
import inspectorStyles from './MaterialInspector.module.scss'
import managementStyles from './MaterialManagement.module.scss'

const styleMaps = [pageStyles, flowStyles, inspectorStyles, managementStyles]

/**
 * Keep feature overrides and shared application contracts on the same node.
 * Material pages reuse shared layout classes such as `page-stack`; returning
 * only the feature-local class drops the grid and viewport sizing rules.
 */
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
