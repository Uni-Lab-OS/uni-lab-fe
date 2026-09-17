import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  ActionParameterForm,
  createArgumentDraft,
  mergeArgumentDraft,
} from './DevicePanelPresentation'

describe('device action argument drafts', () => {
  it('does not let a stale cleared value hide a newly declared default', () => {
    const fallback = createArgumentDraft({
      duration: { type: 'number', required: false, default: 30 }
    })
    expect(mergeArgumentDraft(fallback, { duration: '' })).toEqual({
      duration: '30'
    })
  })

  it('renders action arguments with the prototype table hierarchy', () => {
    const markup = renderToStaticMarkup(
      <ActionParameterForm
        action={{
          actionName: 'reset',
          actionRef: 'robot.reset',
          displayName: '设备复位',
          label: '设备复位',
          typeName: 'Reset',
          isBusy: false,
          currentJobId: null,
          schema: null,
          inputSchema: {
            timeout: {
              type: 'integer',
              required: true,
              title: '超时时间 / 秒',
              description: '本次动作允许的最大执行时间。'
            }
          },
          outputSchema: {},
          riskLevel: 'normal'
        }}
        draft={{ timeout: '30' }}
        disabled={false}
        onChange={() => {}}
      />
    )
    expect(markup).toContain('参数值')
    expect(markup).toContain('参数说明')
    expect(markup).toContain('timeout')
    expect(markup).toContain('本次动作允许的最大执行时间。')
  })
})
