import type { ChangeEvent } from 'react'

import type { LocalRuntimeLaunchConfig } from '../types/electron'

import styles from './LocalRuntimeLauncher.module.scss'

interface LocalRuntimeEdgeCommandEditorProps {
  config: LocalRuntimeLaunchConfig
  disabled: boolean
  submitted: boolean
  executableError?: string
  loadingGeneratedCommand: boolean
  onChange: (config: LocalRuntimeLaunchConfig) => void
  onChooseExecutable: () => void
  onLoadGeneratedCommand: () => void
}

const EDGE_COMMAND_TOKENS = [
  ['{{unilab}}', '所选 Conda 环境中的 unilab 可执行文件'],
  ['{{python}}', '所选 Conda 环境中的 Python 可执行文件'],
  ['{{workspace}}', '当前领域设备包根目录'],
  ['{{graph}}', '当前设备图 JSON'],
  ['{{config}}', '领域设备包 deployment/local_config.py'],
  ['{{working_dir}}', '本次 Edge 运行目录'],
  ['{{edge_http_port}}', 'Edge HTTP 固定端口 18003'],
  ['{{hostlink_port}}', 'HostLink 固定端口 18004']
] as const

/**
 * 呈现领域侧 Edge 的默认/自定义启动方式，并把用户输入保留为结构化参数列表。
 *
 * @param props 当前本地运行配置、禁用状态、校验错误和配置更新回调。
 * @returns 与现有本地调试弹窗一致的可访问启动命令编辑区域。
 */
export default function LocalRuntimeEdgeCommandEditor({
  config,
  disabled,
  submitted,
  executableError,
  loadingGeneratedCommand,
  onChange,
  onChooseExecutable,
  onLoadGeneratedCommand
}: LocalRuntimeEdgeCommandEditorProps): React.JSX.Element {
  const customEnabled = config.edgeCommandMode === 'custom'
  const hasWorkspace = Boolean(config.szlabProjectPath.trim())
  const argumentText = config.customEdgeCommand.args.join('\n')

  /** 将启动方式切换为系统生成计划，同时保留用户之前填写的自定义值。 */
  const useGeneratedCommand = (): void => {
    onChange({ ...config, edgeCommandMode: 'generated' })
  }

  /** 将启动方式切换为自定义计划；领域设备包路径为空时保持失败关闭。 */
  const useCustomCommand = (): void => {
    if (!hasWorkspace) return
    onChange({ ...config, edgeCommandMode: 'custom' })
  }

  /**
   * 更新自定义可执行文件原文。
   *
   * @param event 可执行文件输入框的变更事件。
   */
  const updateExecutable = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({
      ...config,
      customEdgeCommand: {
        ...config.customEdgeCommand,
        executable: event.target.value
      }
    })
  }

  /**
   * 把多行参数输入转换为逐项参数；每一物理行对应一个 `spawn` 参数。
   *
   * @param event 参数文本域的变更事件。
   */
  const updateArguments = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    onChange({
      ...config,
      customEdgeCommand: {
        ...config.customEdgeCommand,
        args: event.target.value.split(/\r?\n/)
      }
    })
  }

  return (
    <fieldset className={styles.commandEditor} disabled={disabled}>
      <legend id="edge-command-mode-label">Edge 启动方式</legend>
      <div
        className={styles.commandModeControl}
        role="radiogroup"
        aria-labelledby="edge-command-mode-label"
      >
        <label data-active={!customEnabled || undefined}>
          <input
            type="radio"
            name="edge-command-mode"
            value="generated"
            checked={!customEnabled}
            onChange={useGeneratedCommand}
          />
          <span>
            <strong>系统默认</strong>
            <small>生成 ROS、FastAPI 和调度器参数</small>
          </span>
        </label>
        <label
          data-active={customEnabled || undefined}
          data-disabled={!hasWorkspace || undefined}
        >
          <input
            type="radio"
            name="edge-command-mode"
            value="custom"
            checked={customEnabled}
            disabled={disabled || !hasWorkspace}
            onChange={useCustomCommand}
          />
          <span>
            <strong>自定义命令</strong>
            <small>可执行文件与参数分开保存</small>
          </span>
        </label>
      </div>

      {!hasWorkspace ? (
        <p className={styles.commandModeHint}>
          填写领域项目根目录后，才可为领域设备包启用自定义命令。
        </p>
      ) : null}

      {customEnabled ? (
        <div className={styles.customCommandPanel}>
          <div className={styles.commandPanelHeader}>
            <p>选择启动程序，并按实际顺序填写参数。</p>
            <button
              type="button"
              className={styles.commandTemplateButton}
              disabled={disabled || loadingGeneratedCommand}
              onClick={onLoadGeneratedCommand}
            >
              {loadingGeneratedCommand ? '正在读取…' : '填入默认命令'}
            </button>
          </div>

          <label className={styles.field} htmlFor="edge-command-executable">
            <span className={styles.fieldLabel}>启动程序</span>
            <span
              className={styles.pathEditor}
              data-invalid={submitted && Boolean(executableError)}
              data-disabled={disabled}
            >
              <input
                id="edge-command-executable"
                className={styles.pathInput}
                value={config.customEdgeCommand.executable}
                placeholder="例如 {{unilab}}、C:\\...\\unilab.exe 或 /usr/local/bin/python"
                maxLength={4_096}
                disabled={disabled}
                aria-invalid={submitted && Boolean(executableError)}
                aria-describedby={executableError
                  ? 'edge-command-executable-error'
                  : 'edge-command-executable-hint'}
                onChange={updateExecutable}
              />
              <button
                type="button"
                className={styles.pathBrowse}
                disabled={disabled}
                onClick={onChooseExecutable}
              >
                选择文件
              </button>
            </span>
            {submitted && executableError ? (
              <span
                id="edge-command-executable-error"
                className={styles.fieldError}
              >
                {executableError}
              </span>
            ) : (
              <span id="edge-command-executable-hint" className={styles.fieldHint}>
                推荐使用默认的 unilab，也可以选择其它可执行文件。
              </span>
            )}
          </label>

          <label className={styles.field} htmlFor="edge-command-arguments">
            <span className={styles.fieldLabel}>启动参数</span>
            <textarea
              id="edge-command-arguments"
              className={styles.commandArguments}
              value={argumentText}
              placeholder={'每行一个参数，例如：\n-m\nunilabos.app.main\n--workspace\n{{workspace}}'}
              maxLength={32_768}
              rows={6}
              disabled={disabled}
              spellCheck={false}
              aria-describedby="edge-command-arguments-hint"
              onChange={updateArguments}
            />
            <span id="edge-command-arguments-hint" className={styles.fieldHint}>
              每行一个参数；路径包含空格时无需添加引号。
            </span>
          </label>

          <details className={styles.commandAdvanced}>
            <summary>
              <span>高级设置</span>
              <small>占位符、命令预览与兼容说明</small>
            </summary>
            <div className={styles.commandAdvancedBody}>
              <div className={styles.commandTokens}>
                <strong>可用占位符</strong>
                <dl>
                  {EDGE_COMMAND_TOKENS.map(([token, description]) => (
                    <div key={token}>
                      <dt><code>{token}</code></dt>
                      <dd>{description}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <div className={styles.commandPreview} aria-live="polite">
                <span>最终命令预览</span>
                <code>{formatCommandPreview(config)}</code>
              </div>

              <ul className={styles.commandCompatibilityNotes}>
                <li>程序和参数会分别启动，不经过 shell。</li>
                <li>Windows 仅支持绝对 .exe 路径，不执行 cmd、PowerShell 或脚本。</li>
                <li>启动器继续管理 Conda、运行目录、18003/18004 端口和运行环境。</li>
                <li>启动前会由系统对话框再次确认最终程序与参数。</li>
              </ul>
            </div>
          </details>
        </div>
      ) : null}
    </fieldset>
  )
}

/**
 * 生成人类可读但绝不参与执行的命令预览，明确展示每个参数的独立边界。
 *
 * @param config 当前本地运行配置。
 * @returns 使用 JSON 字符串形式包裹参数的单行预览。
 */
function formatCommandPreview(config: LocalRuntimeLaunchConfig): string {
  const command = config.customEdgeCommand.executable.trim() || '<可执行文件>'
  const args = config.customEdgeCommand.args.filter((argument) => argument.trim())
  return [command, ...args.map((argument) => JSON.stringify(argument))].join(' ')
}
