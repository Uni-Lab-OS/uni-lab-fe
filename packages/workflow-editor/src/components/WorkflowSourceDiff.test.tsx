import { readFileSync } from 'node:fs'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import {
  WorkflowSourceDiff,
  buildIntralineSourceDiff,
  buildWorkflowSourceDiff
} from './WorkflowSourceDiff'

describe('buildWorkflowSourceDiff', () => {
  /** 验证源码复核展示真正的行级语义，而不是两份完整文本并排。 */
  it('aligns unchanged, modified, added, and deleted Python lines', () => {
    const rows = buildWorkflowSourceDiff(
      [
        'def workflow():',
        '    prepare()',
        '    obsolete()',
        '    return result'
      ].join('\n'),
      [
        'def workflow():',
        '    prepare(sample)',
        '    return result',
        '    archive(result)'
      ].join('\n')
    )

    expect(rows).toEqual([
      {
        kind: 'unchanged',
        beforeLineNumber: 1,
        afterLineNumber: 1,
        beforeText: 'def workflow():',
        afterText: 'def workflow():'
      },
      {
        kind: 'modified',
        beforeLineNumber: 2,
        afterLineNumber: 2,
        beforeText: '    prepare()',
        afterText: '    prepare(sample)'
      },
      {
        kind: 'deleted',
        beforeLineNumber: 3,
        afterLineNumber: null,
        beforeText: '    obsolete()',
        afterText: null
      },
      {
        kind: 'unchanged',
        beforeLineNumber: 4,
        afterLineNumber: 3,
        beforeText: '    return result',
        afterText: '    return result'
      },
      {
        kind: 'added',
        beforeLineNumber: null,
        afterLineNumber: 4,
        beforeText: null,
        afterText: '    archive(result)'
      }
    ])
  })
})

describe('WorkflowSourceDiff', () => {
  /** 验证修改行内部只强调真正变化的 Python 词元。 */
  it('highlights changed tokens inside a modified line', () => {
    const intraline = buildIntralineSourceDiff(
      '    prepare(sample_id="old", retries=3)',
      '    prepare(sample_id="new", retries=5)'
    )

    expect(intraline.beforeRanges.map((range) =>
      '    prepare(sample_id="old", retries=3)'.slice(range.start, range.end)
    )).toEqual(['old', '3'])
    expect(intraline.afterRanges.map((range) =>
      '    prepare(sample_id="new", retries=5)'.slice(range.start, range.end)
    )).toEqual(['new', '5'])
  })

  /** 验证颜色之外仍有 +/-/~ 文本标记，并同时提供左右与统一视图。 */
  it('renders accessible line-level markers for split and unified layouts', () => {
    const markup = renderToStaticMarkup(
      <WorkflowSourceDiff
        before={'keep()\nremove()\nchange()'}
        after={'keep()\nadd()\nchanged()'}
      />
    )

    expect(markup).toContain('aria-label="Python 代码差异"')
    expect(markup).toContain('persistent-source-diff__split')
    expect(markup).toContain('persistent-source-diff__unified')
    expect(markup).toContain('aria-label="删除"')
    expect(markup).toContain('aria-label="新增"')
    expect(markup).toContain('aria-label="修改前"')
    expect(markup).toContain('aria-label="修改后"')
  })

  /** 验证代码审查视图包含 Python 语法、行内变更和 Git 风格 hunk。 */
  it('renders a GitLab-like Python patch instead of plain source rows', () => {
    const before = Array.from({ length: 20 }, (_, index) =>
      index === 9
        ? 'def prepare(sample="old"): # previous value'
        : `run_step_${index + 1}()`
    ).join('\n')
    const after = Array.from({ length: 20 }, (_, index) =>
      index === 9
        ? 'def prepare(sample="new"): # generated value'
        : `run_step_${index + 1}()`
    ).join('\n')

    const markup = renderToStaticMarkup(
      <WorkflowSourceDiff before={before} after={after} />
    )

    expect(markup).toContain('persistent-source-diff__hunk')
    expect(markup).toContain('@@ -7,7 +7,7 @@')
    expect(markup).toContain('展开 6 行未修改代码')
    expect(markup).toContain('展开 7 行未修改代码')
    expect(markup).toContain('token-keyword')
    expect(markup).toContain('token-string')
    expect(markup).toContain('token-comment')
    expect(markup).toContain('is-intraline-change')
  })

  /** 验证弹窗与代码视图使用视口和滚动合同，避免头尾与横向内容被裁掉。 */
  it('keeps the dialog controls fixed and adapts by viewport width', () => {
    const stylesheet = readFileSync(
      new URL('./workflow-persistent/_section-05.scss', import.meta.url),
      'utf8'
    )

    expect(stylesheet).toMatch(
      /persistent-authoring__diff[\s\S]*grid-template-rows:\s*auto minmax\(0,\s*1fr\) auto/
    )
    expect(stylesheet).toMatch(
      /persistent-source-diff__scroller[\s\S]*overflow-x:\s*auto[\s\S]*overflow-y:\s*scroll/
    )
    expect(stylesheet).toMatch(
      /@media\s*\(max-width:\s*760px\)[\s\S]*persistent-source-diff__split[\s\S]*display:\s*none[\s\S]*persistent-source-diff__unified[\s\S]*display:\s*grid/
    )
  })
})
