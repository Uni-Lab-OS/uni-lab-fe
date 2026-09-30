import device from './device.module.scss'
import material from './material.module.scss'
import reagent from './reagent.module.scss'
import run from './run.module.scss'
import shared from './shared.module.scss'
import task from './task.module.scss'
import workflow from './workflow.module.scss'

const maps = [material, device, reagent, run, task, workflow, shared]

/** Resolve a component class through its owning module; preserve third-party classes. */
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
