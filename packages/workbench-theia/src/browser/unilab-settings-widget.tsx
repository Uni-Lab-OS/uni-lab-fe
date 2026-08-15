import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget'
import {
  BuiltinThemeProvider,
  ThemeService
} from '@theia/core/lib/browser/theming'
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify'
import * as React from 'react'

import { applyUniLabTheme } from './unilab-theme'

@injectable()
export class UniLabSettingsWidget extends ReactWidget {
  static readonly ID = 'unilab:settings'
  static readonly LABEL = '设置'

  @inject(ThemeService)
  protected readonly themeService!: ThemeService

  @postConstruct()
  protected init(): void {
    this.id = UniLabSettingsWidget.ID
    this.title.label = UniLabSettingsWidget.LABEL
    this.title.caption = 'UniLab 界面设置'
    this.title.closable = false
    this.title.iconClass = 'codicon codicon-settings-gear'
    this.node.classList.add('unilab-settings-widget')
    this.syncTheme()
    this.toDispose.push(this.themeService.onDidColorThemeChange(() => {
      this.syncTheme()
      this.update()
    }))
    this.update()
  }

  protected syncTheme(): void {
    applyUniLabTheme(this.themeService.getCurrentTheme().type)
  }

  /** 切换到用户选择的内置明暗主题并持久化。 */
  protected readonly setTheme = (themeId: string): void => {
    this.themeService.setCurrentTheme(themeId, true)
    this.syncTheme()
    this.update()
  }

  protected override render(): React.ReactElement {
    const mode = this.themeService.getCurrentTheme().type === 'dark'
      ? 'dark'
      : 'light'
    return (
      <section className="unilab-settings" aria-label="界面设置">
        <header>
          <h2>界面设置</h2>
          <p>选择适合当前实验室环境的背景模式。</p>
        </header>
        <div className="unilab-settings__theme" role="group" aria-label="背景模式">
          <button
            type="button"
            aria-pressed={mode === 'light'}
            onClick={() => this.setTheme(BuiltinThemeProvider.lightTheme.id)}
          >
            <span className="codicon codicon-sun" aria-hidden="true" />
            <strong>浅色背景</strong>
            <small>适合明亮环境</small>
          </button>
          <button
            type="button"
            aria-pressed={mode === 'dark'}
            onClick={() => this.setTheme(BuiltinThemeProvider.darkTheme.id)}
          >
            <span className="codicon codicon-color-mode" aria-hidden="true" />
            <strong>深色背景</strong>
            <small>适合低照度环境</small>
          </button>
        </div>
        <p className="unilab-settings__status" role="status">
          当前使用：{mode === 'dark' ? '深色背景' : '浅色背景'}
        </p>
      </section>
    )
  }
}
