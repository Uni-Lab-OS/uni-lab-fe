import styles from './DebugTargetModal.module.scss'

/** Resolve only the classes owned by the debug target modal. */
export function cx(...names: Array<string | false | null | undefined>): string {
  return names
    .filter((name): name is string => Boolean(name))
    .flatMap((name) => name.split(/\s+/))
    .filter(Boolean)
    .map((name) => styles[name] ?? name)
    .filter((name, index, all) => all.indexOf(name) === index)
    .join(' ')
}
