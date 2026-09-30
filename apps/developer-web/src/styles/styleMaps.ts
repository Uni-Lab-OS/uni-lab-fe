import appShell from './app-shell.module.scss'
import devices from './devices.module.scss'
import materials from './materials.module.scss'
import overview from './overview.module.scss'
import reagents from './reagents.module.scss'
import shared from './shared.module.scss'
import workflows from './workflows.module.scss'

const maps = [appShell, shared, overview, materials, devices, reagents, workflows]

/** Resolve app classes through the module that owns them.
 * Unknown values are preserved for third-party utility classes such as
 * React Flow's `nodrag`/`nopan` and AntD's runtime classes.
 */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter((name): name is string => Boolean(name))
    .flatMap((name) => name.split(/\s+/))
    .filter(Boolean)
    .flatMap((name) => {
      const resolved = maps.flatMap((styles) => (styles[name] ? [styles[name]] : []))
      return resolved.length > 0 ? resolved : [name]
    })
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(' ')
}
