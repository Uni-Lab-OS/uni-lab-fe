import { cx as resolveAppClassNames } from '../../styles/styleMaps'
import pageStyles from './DevicePage.module.scss'
import detailStyles from './DeviceDetailPage.module.scss'
import editorStyles from './DeviceActionEditor.module.scss'

const styleMaps = [pageStyles, detailStyles, editorStyles]

/** Resolve device feature classes locally before falling back to shared app classes. */
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
