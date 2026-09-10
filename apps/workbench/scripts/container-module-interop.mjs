const readableLoader = 'container.load(containerModule.default)'
const readableNormalizedLoader =
  'container.load(containerModule.default?.registry ? containerModule.default : containerModule.default?.default)'

const minifiedLoader =
  /return Promise\.resolve\(([\w$]+)\)\.then\(([\w$]+)=>([\w$]+)\.load\(\2\.default\)\)/gu

const minifiedNormalizedLoader =
  /return Promise\.resolve\(([\w$]+)\)\.then\(([\w$]+)=>([\w$]+)\.load\(\2\.default\?\.registry\?\2\.default:\2\.default\?\.default\)\)/u

export function hasNormalizedContainerModuleInterop(bundle) {
  return bundle.includes(readableNormalizedLoader)
    || minifiedNormalizedLoader.test(bundle)
}

/** Normalize Theia's generated dynamic ContainerModule loader across build modes. */
export function normalizeContainerModuleInteropBundle(bundle) {
  if (bundle.includes(readableLoader)) {
    return bundle.replaceAll(readableLoader, readableNormalizedLoader)
  }
  if (hasNormalizedContainerModuleInterop(bundle)) {
    return bundle
  }

  let replacementCount = 0
  const normalized = bundle.replace(
    minifiedLoader,
    (_match, promiseValue, containerModule, container) => {
      replacementCount += 1
      return `return Promise.resolve(${promiseValue}).then(${containerModule}=>${container}.load(${containerModule}.default?.registry?${containerModule}.default:${containerModule}.default?.default))`
    }
  )
  if (replacementCount === 1) return normalized
  throw new Error(
    replacementCount === 0
      ? 'Theia frontend container-module loader was not found in bundle.js'
      : `Theia frontend bundle contains ${replacementCount} ambiguous container-module loaders`
  )
}
