import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import {
  matchWorkspaceDeviceCard,
  preferredWorkbenchDeviceMode,
  resolveWorkbenchCardWorkspacePath,
  WorkbenchDeviceModeSwitcher
} from './workbench-device-surface'

describe('工作台仪器设备表面', () => {
  /** 证明领域包提供定制卡片时，仪器设备默认打开定制卡片且保留通用动作入口。 */
  it('defaults to the custom card while preserving generic actions', () => {
    const mode = preferredWorkbenchDeviceMode(true)
    const markup = renderToStaticMarkup(
      <WorkbenchDeviceModeSwitcher
        mode={mode}
        customCardAvailable
        onChange={vi.fn()}
      />
    )

    expect(mode).toBe('custom-card')
    expect(markup).toContain('通用动作')
    expect(markup).toContain('定制卡片')
    expect(markup).toMatch(
      /aria-selected="true"[^>]*>定制卡片|>定制卡片<[^]*aria-selected="true"/u
    )
  })

  /** 证明没有定制卡片时，仪器设备直接落到通用动作且不展示无效页签。 */
  it('falls back to generic actions when no custom card is available', () => {
    const mode = preferredWorkbenchDeviceMode(false)
    const markup = renderToStaticMarkup(
      <WorkbenchDeviceModeSwitcher
        mode={mode}
        customCardAvailable={false}
        onChange={vi.fn()}
      />
    )

    expect(mode).toBe('generic-actions')
    expect(markup).toContain('通用动作')
    expect(markup).not.toContain('定制卡片')
  })

  /** 证明定制卡片只会让其声明支持且确实在线注册的设备进入默认卡片页。 */
  it('matches a package card to a compatible catalog device', () => {
    expect(matchWorkspaceDeviceCard([{
      deviceTypes: ['szlab.devices.robot:Robot'],
      id: 'community.ptlc.robot.card',
      projectDir: '/workspace/frontend/cards/robot-card',
      title: 'pTLC 机械臂调试卡片',
      version: '1.0.0'
    }], [{
      actions: [],
      deviceId: 'robot',
      deviceKey: 'robot',
      deviceTypeId: 'szlab.devices.robot:Robot',
      label: 'CR5',
      materialUuid: 'material-robot',
      namespace: 'ptlc',
      online: true
    }])).toEqual({
      deviceId: 'robot',
      projectId: 'community.ptlc.robot.card'
    })
  })

  it('falls back to the Theia workspace hash when session path is empty', () => {
    const previous = globalThis.location
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { hash: '#F:/workspace/Uni-Lab-SZLab' }
    })
    try {
      expect(resolveWorkbenchCardWorkspacePath('')).toBe(
        'F:/workspace/Uni-Lab-SZLab'
      )
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: previous
      })
    }
  })
})
