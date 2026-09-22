import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  ActionParameterForm,
  createArgumentDraft,
  mergeArgumentDraft,
} from './DevicePanelPresentation'

describe('device action argument drafts', () => {
  it('fills a default value for every action parameter', () => {
    expect(createArgumentDraft({
      sample_id: { type: 'string', required: false, default: '' },
      speed: { type: 'number', required: false },
      enabled: { type: 'boolean', required: false },
      labels: { type: 'array', required: false },
      beaker: { type: 'object', required: true },
      direction: { type: 'string', required: false, enum: ['cw', 'ccw'] }
    })).toEqual({
      sample_id: '',
      speed: '0',
      enabled: false,
      labels: '[]',
      beaker: '',
      direction: 'cw'
    })
  })

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

  it('shows click-time field errors without disabling the form', () => {
    const markup = renderToStaticMarkup(
      <ActionParameterForm
        action={{
          actionName: 'inspect_beaker',
          actionRef: 's05.inspect_beaker',
          displayName: 'S05 烧杯拍照检测',
          label: 'S05 烧杯拍照检测',
          typeName: 'UniLabJsonCommand',
          isBusy: false,
          currentJobId: null,
          schema: null,
          inputSchema: {
            beaker: { type: 'object', required: true, title: '烧杯' }
          },
          outputSchema: {},
          riskLevel: 'normal'
        }}
        draft={{ beaker: '' }}
        errors={{ beaker: '烧杯 为必填项' }}
        disabled={false}
        onChange={() => {}}
      />
    )
    expect(markup).toContain('烧杯 为必填项')
    expect(markup).toContain('is-invalid')
  })
})
