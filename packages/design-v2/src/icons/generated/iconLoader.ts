// Generated from the read-only Figma Bohr icon export. Do not edit by hand.
// Regenerate with: pnpm --dir packages/design-v2 build:icons -- --source-dir <export>/clean

import type { IconName } from './manifest'

export interface ResolvedIconData {
  body: string
  viewBox: string
}

type IconCategoryModule = { ICON_CATEGORY_DATA: Record<string, ResolvedIconData> }
type IconCategory = keyof typeof ICON_CATEGORY_LOADERS

const ICON_CATEGORY_LOADERS = {
  'alerts-feedback': () => import('./categories/alerts-feedback'),
  'arrows': () => import('./categories/arrows'),
  'charts': () => import('./categories/charts'),
  'communication': () => import('./categories/communication'),
  'development': () => import('./categories/development'),
  'editor': () => import('./categories/editor'),
  'education': () => import('./categories/education'),
  'files': () => import('./categories/files'),
  'finance-ecommerce': () => import('./categories/finance-ecommerce'),
  'general': () => import('./categories/general'),
  'images': () => import('./categories/images'),
  'layout': () => import('./categories/layout'),
  'maps': () => import('./categories/maps'),
  'media': () => import('./categories/media'),
  'security': () => import('./categories/security'),
  'shapes': () => import('./categories/shapes'),
  'time': () => import('./categories/time'),
  'users': () => import('./categories/users'),
  'weather': () => import('./categories/weather'),
} as const

const categoryCache = new Map<string, Promise<IconCategoryModule>>()
const iconCache = new Map<string, ResolvedIconData>()

export function iconCategoryFromName(name: string): string {
  return name.split('/')[0] ?? ''
}

function loadCategory(category: string): Promise<IconCategoryModule> {
  const cached = categoryCache.get(category)
  if (cached) return cached
  const loader = ICON_CATEGORY_LOADERS[category as IconCategory]
  if (!loader) return Promise.reject(new Error('Unknown Bohr icon category: ' + category))
  const promise = loader()
  categoryCache.set(category, promise)
  return promise
}

export function getCachedIconData(name: IconName): ResolvedIconData | undefined {
  return iconCache.get(name)
}

export function loadIconData(name: IconName): Promise<ResolvedIconData> {
  const cached = iconCache.get(name)
  if (cached) return Promise.resolve(cached)
  const category = iconCategoryFromName(name)
  return loadCategory(category).then((module) => {
    const data = module.ICON_CATEGORY_DATA[name]
    if (!data) throw new Error('Unknown Bohr icon: ' + name)
    iconCache.set(name, data)
    return data
  })
}

export function preloadIconCategory(category: string): Promise<void> {
  return loadCategory(category).then(() => undefined)
}
