/**
 * ============================================================
 * AI-GENERATED CODE METADATA
 * ============================================================
 * Model: Claude Opus 4.8
 * Generation Date: 2026-07-22
 * Prompt Summary: CodeMirror 6 生命周期管理 hook(yaml/json 语言 + isDirty)
 * Context: 替换 textarea 编辑器,供设备(YAML)/工作流(JSON)方向复用
 * Human Review Status: [ ] Pending  [ ] Reviewed  [ ] Approved
 * ============================================================
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  EditorState,
  RangeSet,
  StateEffect,
  StateField
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  gutter,
  highlightActiveLine,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { python } from '@codemirror/lang-python'
import { yaml } from '@codemirror/lang-yaml'
import { oneDark } from '@codemirror/theme-one-dark'
import type { Extension } from '@codemirror/state'
import type { DecorationSet } from '@codemirror/view'

export type EditorLanguage = 'yaml' | 'json' | 'python'

export interface CodeLineMarker {
  nodeId?: string
  line: number
  kind:
    | 'before-start'
    | 'start'
    | 'breakpoint'
    | 'paused'
    | 'running'
    | 'success'
    | 'failed'
    | 'skipped'
  label: string
}

export interface UseCodeMirrorResult {
  value: string
  baseline: string
  isDirty: boolean
  containerRef: React.RefObject<HTMLDivElement | null>
  replaceContent: (next: string) => void
  markSaved: () => void
  setLineMarkers: (markers: ReadonlyArray<CodeLineMarker>) => void
  revealLine: (line: number) => void
}

const MARKER_GLYPHS: Readonly<Record<CodeLineMarker['kind'], string>> = {
  'before-start': '—',
  start: '⚑',
  breakpoint: '●',
  paused: 'Ⅱ',
  running: '●',
  success: '✓',
  failed: '×',
  skipped: '—'
}

interface AnchoredCodeMarker {
  key: string
  marker: CodeLineMarker
  position: number
  sourceLine: number
}

interface CodeMarkerState {
  anchors: ReadonlyArray<AnchoredCodeMarker>
  decorations: DecorationSet
  gutterMarkers: RangeSet<GutterMarker>
}

const setCodeMarkers = StateEffect.define<
  ReadonlyArray<CodeLineMarker>
>()

class CodeMarkerGutter extends GutterMarker {
  constructor(
    private readonly markers: ReadonlyArray<CodeLineMarker>,
    private readonly lineNumber: number
  ) {
    super()
  }

  eq(other: CodeMarkerGutter): boolean {
    return (
      other.lineNumber === this.lineNumber &&
      other.markers.length === this.markers.length &&
      other.markers.every((marker, index) => {
        const current = this.markers[index]
        return (
          marker.kind === current.kind &&
          marker.label === current.label
        )
      })
    )
  }

  toDOM(): HTMLElement {
    const group = document.createElement('span')
    group.className = 'cm-workflow-markers'
    group.dataset.line = String(this.lineNumber)
    for (const marker of this.markers) {
      const element = document.createElement('span')
      element.className =
        `cm-workflow-marker cm-workflow-marker--${marker.kind}`
      element.dataset.line = String(this.lineNumber)
      element.textContent = MARKER_GLYPHS[marker.kind]
      element.title = marker.label
      element.setAttribute('aria-label', marker.label)
      group.append(element)
    }
    return group
  }
}

function markerExtension(markers: ReadonlyArray<CodeLineMarker>): Extension {
  const markerState = StateField.define<CodeMarkerState>({
    create(state) {
      return buildMarkerState(
        state,
        reconcileCodeMarkers(state, [], markers)
      )
    },
    update(current, transaction) {
      let anchors = current.anchors.map((anchor) => ({
        ...anchor,
        position: transaction.changes.mapPos(anchor.position, 1)
      }))
      for (const effect of transaction.effects) {
        if (effect.is(setCodeMarkers)) {
          anchors = reconcileCodeMarkers(
            transaction.state,
            anchors,
            effect.value
          )
        }
      }
      return buildMarkerState(transaction.state, anchors)
    },
    provide: (field) => [
      EditorView.decorations.from(
        field,
        (value) => value.decorations
      ),
      gutter({
        class: 'cm-workflow-marker-gutter',
        markers: (view) => view.state.field(field).gutterMarkers
      })
    ]
  })
  return markerState
}

function reconcileCodeMarkers(
  state: EditorState,
  current: ReadonlyArray<AnchoredCodeMarker>,
  markers: ReadonlyArray<CodeLineMarker>
): AnchoredCodeMarker[] {
  const byKey = new Map(current.map((anchor) => [anchor.key, anchor]))
  const byNode = new Map<string, AnchoredCodeMarker>()
  for (const anchor of current) {
    if (anchor.marker.nodeId && !byNode.has(anchor.marker.nodeId)) {
      byNode.set(anchor.marker.nodeId, anchor)
    }
  }
  return markers.map((marker, index) => {
    const key = codeMarkerKey(marker, index)
    const previous = byKey.get(key) ||
      (marker.nodeId ? byNode.get(marker.nodeId) : undefined)
    const sourceLine = marker.line
    const preserveMappedPosition =
      previous?.sourceLine === sourceLine
    const position = preserveMappedPosition
      ? state.doc.lineAt(
          Math.min(previous.position, state.doc.length)
        ).from
      : state.doc.line(clampLine(sourceLine, state.doc.lines)).from
    return {
      key,
      marker,
      position,
      sourceLine
    }
  })
}

function buildMarkerState(
  state: EditorState,
  anchors: ReadonlyArray<AnchoredCodeMarker>
): CodeMarkerState {
  const grouped = new Map<number, CodeLineMarker[]>()
  for (const anchor of anchors) {
    const line = state.doc.lineAt(
      Math.min(anchor.position, state.doc.length)
    )
    const current = grouped.get(line.from) || []
    current.push(anchor.marker)
    grouped.set(line.from, current)
  }
  const entries = [...grouped.entries()]
    .sort(([left], [right]) => left - right)
  const decorations = Decoration.set(
    entries.map(([position, lineMarkers]) => {
      const classes = lineMarkers
        .map((marker) => `cm-workflow-line--${marker.kind}`)
        .join(' ')
      return Decoration.line({
        attributes: { class: `cm-workflow-line ${classes}` }
      }).range(position)
    }),
    true
  )
  const gutterMarkers = RangeSet.of(
    entries.map(([position, lineMarkers]) => {
      const lineNumber = state.doc.lineAt(position).number
      return new CodeMarkerGutter(lineMarkers, lineNumber)
        .range(position)
    }),
    true
  )
  return { anchors, decorations, gutterMarkers }
}

function codeMarkerKey(marker: CodeLineMarker, index: number): string {
  return marker.nodeId
    ? `${marker.nodeId}:${marker.kind}`
    : `${marker.line}:${marker.kind}:${marker.label}:${index}`
}

function clampLine(line: number, lineCount: number): number {
  return Math.max(1, Math.min(line, lineCount))
}

// 按语言返回对应的语法扩展;JSON 复用 YAML 高亮(JSON 是 YAML 子集)
function languageExtension(language: EditorLanguage): Extension {
  return language === 'python' ? python() : yaml()
}

// 管理 CodeMirror 6 实例:挂载、内容同步、isDirty 判定、语言切换
export function useCodeMirror(
  initialValue: string,
  language: EditorLanguage,
  initialBaseline = initialValue
): UseCodeMirrorResult {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const markersRef = useRef<ReadonlyArray<CodeLineMarker>>([])
  const [value, setValue] = useState(initialValue)
  const [baseline, setBaseline] = useState(initialBaseline)

  // 初始化编辑器实例;语言变化时重建以套用新语法
  useEffect(() => {
    if (!containerRef.current) return

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) setValue(update.state.doc.toString())
    })

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        history(),
        highlightActiveLine(),
        bracketMatching(),
        indentOnInput(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        languageExtension(language),
        markerExtension(markersRef.current),
        oneDark,
        EditorView.lineWrapping,
        updateListener
      ]
    })

    const view = new EditorView({ state, parent: containerRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // 仅在语言变化时重建;value 变更通过 replaceContent 走 dispatch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  // 用外部内容整体替换,并作为新基准
  const replaceContent = useCallback((next: string) => {
    const view = viewRef.current
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next }
      })
    }
    setValue(next)
    setBaseline(next)
  }, [])

  // 标记为已保存:把当前内容设为新基准(isDirty 归零),不改动文档
  const markSaved = useCallback(() => {
    const current = viewRef.current?.state.doc.toString()
    if (current != null) setBaseline(current)
  }, [])

  const setLineMarkers = useCallback((
    markers: ReadonlyArray<CodeLineMarker>
  ) => {
    markersRef.current = [...markers]
    const view = viewRef.current
    if (view) {
      view.dispatch({
        effects: setCodeMarkers.of(markersRef.current)
      })
    }
  }, [])

  const revealLine = useCallback((lineNumber: number) => {
    const view = viewRef.current
    if (!view) return
    const line = view.state.doc.line(
      Math.max(1, Math.min(lineNumber, view.state.doc.lines))
    )
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' })
    })
    view.focus()
  }, [])

  return {
    value,
    baseline,
    isDirty: value !== baseline,
    containerRef,
    replaceContent,
    markSaved,
    setLineMarkers,
    revealLine
  }
}
