import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import {
  compileScript,
  compileStyle,
  compileTemplate,
  parse
} from '@vue/compiler-sfc'
import type { Plugin } from 'esbuild'

export function vueSfcPlugin(): Plugin {
  return {
    name: 'unilab-vue-sfc',
    setup(build) {
      build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8')
        const { descriptor, errors } = parse(source, { filename: args.path })
        if (errors.length > 0) {
          return {
            errors: errors.map((error) => ({
              text: error instanceof Error ? error.message : String(error)
            }))
          }
        }
        const id = createHash('sha256')
          .update(args.path)
          .digest('hex')
          .slice(0, 8)
        const unsupportedStyle = descriptor.styles.find((style) =>
          style.lang && style.lang !== 'css'
        )
        if (unsupportedStyle) {
          return {
            errors: [{
              text: `Vue 卡片只支持普通 CSS，不支持 style lang="${unsupportedStyle.lang}"。`
            }]
          }
        }
        const scriptContent = descriptor.script || descriptor.scriptSetup
          ? compileScript(descriptor, {
              id,
              inlineTemplate: true
            }).content
          : templateOnlyComponent(descriptor.template?.content, args.path, id)
        const css = descriptor.styles.map((style) =>
          compileStyle({
            filename: args.path,
            id,
            source: style.content,
            scoped: false
          })
        )
        const styleErrors = css.flatMap((result) => result.errors)
        if (styleErrors.length > 0) {
          return {
            errors: styleErrors.map((error) => ({
              text: error instanceof Error ? error.message : String(error)
            }))
          }
        }
        const combinedCss = css.map((result) => result.code).join('\n')
        return {
          loader: 'ts',
          contents: `${scriptContent}
if (${JSON.stringify(combinedCss)}.length > 0) {
  const style = document.createElement('style')
  style.dataset.unilabCardStyle = ${JSON.stringify(id)}
  style.textContent = ${JSON.stringify(combinedCss)}
  document.head.append(style)
}
`
        }
      })
    }
  }
}

function templateOnlyComponent(
  source: string | undefined,
  filename: string,
  id: string
): string {
  if (!source) {
    throw new Error('Vue 卡片至少需要 template、script 或 script setup。')
  }
  const result = compileTemplate({
    id,
    filename,
    source
  })
  if (result.errors.length > 0) {
    throw new Error(result.errors.map((error) =>
      error instanceof Error ? error.message : String(error)
    ).join('\n'))
  }
  return `${result.code}
const __sfc__ = { render }
export default __sfc__
`
}
