/**
 * Read-only inventory of the Variables collections in the Bohrium design source file.
 *
 * CSS custom properties cannot contain `/`, so the source path is normalized
 * with `-` when it is emitted. The `sourcePath` field remains the canonical
 * name to use when comparing this package with design source.
 */
export interface SourceTokenGroup {
  sourcePath: string
  count: number
}

export interface SourceTokenCollection {
  sourcePath: string
  count: number
  groups: readonly SourceTokenGroup[]
}

const groups = (entries: readonly (readonly [string, number])[]): SourceTokenGroup[] =>
  entries.map(([sourcePath, count]) => ({ sourcePath, count }))

export const SOURCE_TOKEN_COLLECTIONS = [
  {
    sourcePath: '1. Foundation',
    count: 420,
    groups: groups([
      ['spacing', 35],
      ['width', 33],
      ['min-width', 14],
      ['max-width', 15],
      ['height', 33],
      ['breakpoint', 5],
      ['border-radius', 10],
      ['border-width', 9],
      ['stroke-width', 12],
      ['opacity', 21],
      ['line-height', 20],
      ['Bohrium Primitive Color', 177],
      ['compatibility', 36]
    ])
  },
  {
    sourcePath: '2. Theme',
    count: 126,
    groups: groups([
      ['font', 1],
      ['breakpoint', 5],
      ['container', 13],
      ['text', 36],
      ['font-weight', 9],
      ['radius', 8],
      ['shadow', 38],
      ['line-height', 13],
      ['letter-spacing', 1],
      ['paragraph-spacing', 1],
      ['paragraph-indent', 1]
    ])
  },
  {
    sourcePath: '3. Color Modes',
    count: 87,
    groups: groups([
      ['primary', 15],
      ['fill', 6],
      ['border', 4],
      ['text', 4],
      ['icon', 2],
      ['sidebar', 3],
      ['warning', 6],
      ['success', 6],
      ['error', 6],
      ['base', 8],
      ['alpha', 9],
      ['custom', 18]
    ])
  },
  {
    sourcePath: '4. Pro / Responsive',
    count: 29,
    groups: groups([
      ['heading-xl', 5],
      ['heading-lg', 5],
      ['heading-md', 5],
      ['heading-sm', 5],
      ['(root)', 9]
    ])
  },
  { sourcePath: '6. Icon Context', count: 1, groups: groups([['context', 1]]) },
  { sourcePath: '6. Bohr Icon', count: 7, groups: groups([['stroke-width', 7]]) }
] satisfies readonly SourceTokenCollection[]

export const SOURCE_TOKEN_TOTAL = SOURCE_TOKEN_COLLECTIONS.reduce(
  (total, collection) => total + collection.count,
  0
)

/** Convert a design source path such as `base/card` to a stable CSS variable suffix. */
export function sourceVariableSuffix(sourcePath: string): string {
  return sourcePath
    .trim()
    .replace(/^\d+\.\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Reference an emitted raw design source variable. */
export function sourceCssVar(sourcePath: string): string {
  return `var(--bh-source-${sourceVariableSuffix(sourcePath)})`
}
