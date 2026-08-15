import actionStyles from './DeviceManagementActions.module.scss'
import shellStyles from './DeviceManagement.module.scss'

const STYLE_MAPS: ReadonlyArray<Readonly<Record<string, string>>> = [shellStyles, actionStyles]

/**
 * 把旧 BEM token 映射到两个 CSS Module 的局部类名。
 * 同一 token 可能同时出现在壳层和动作样式中，因此必须保留两个模块生成的类名。
 */
export function deviceClass(...values: ReadonlyArray<string | false | null | undefined>): string {
  const tokens = values.flatMap((value) => (value ? value.split(/\s+/).filter(Boolean) : []))
  return [
    ...new Set(
      tokens.flatMap((token) => {
        const localNames = STYLE_MAPS.map((styleMap) => styleMap[token]).filter(Boolean)
        return localNames
      }),
    ),
  ].join(' ')
}
