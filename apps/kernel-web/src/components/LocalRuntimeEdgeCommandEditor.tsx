import type { ChangeEvent, ReactNode } from 'react'

import type { LocalRuntimeLaunchConfig } from '../types/electron'

import styles from './LocalRuntimeLauncher.module.scss'

interface LocalRuntimeEdgeCommandEditorProps {
  config: LocalRuntimeLaunchConfig
  disabled: boolean
  submitted: boolean
  executableError?: string
  workingDirectoryError?: string
  environmentError?: string
  loadingGeneratedCommand: boolean
  workspaceField: ReactNode
  onChange: (config: LocalRuntimeLaunchConfig) => void
  onChooseExecutable: () => void
  onChooseWorkingDirectory: () => void
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
  workingDirectoryError,
  environmentError,
  loadingGeneratedCommand,
  workspaceField,
  onChange,
  onChooseExecutable,
  onChooseWorkingDirectory,
  onLoadGeneratedCommand
}: LocalRuntimeEdgeCommandEditorProps): React.JSX.Element {
  const customEnabled = config.edgeCommandMode === 'custom'
  const argumentText = config.customEdgeCommand.args.join('\n')
  const environmentText = config.customEdgeCommand.environment
    .map(({ name, value }) => `${name}=${value}`)
    .join('\n')

  /** 将启动方式切换为系统生成计划，同时保留用户之前填写的自定义值。 */
  const useGeneratedCommand = (): void => {
    onChange({ ...config, edgeCommandMode: 'generated' })
  }

  /** 将启动方式切换为自定义计划；缺失字段继续由表单与主进程失败关闭。 */
  const useCustomCommand = (): void => {
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

  /**
   * 更新自定义工作目录模板。
   *
   * @param event 工作目录输入框的变更事件。
   */
  const updateWorkingDirectory = (event: ChangeEvent<HTMLInputElement>): void => {
    onChange({
      ...config,
      customEdgeCommand: {
        ...config.customEdgeCommand,
        workingDirectory: event.target.value
      }
    })
  }

  /**
   * 把每行 `NAME=value` 转换为结构化环境变量，值中的后续等号保持原样。
   *
   * @param event 环境变量文本域的变更事件。
   */
  const updateEnvironment = (event: ChangeEvent<HTMLTextAreaElement>): void => {
    const environment = event.target.value.split(/\r?\n/).flatMap((line) => {
      if (!line.trim()) return []
      const separatorIndex = line.indexOf('=')
      return separatorIndex < 0
        ? [{ name: line.trim(), value: '' }]
        : [{
            name: line.slice(0, separatorIndex).trim(),
            value: line.slice(separatorIndex + 1)
          }]
    })
    onChange({
      ...config,
      customEdgeCommand: {
        ...config.customEdgeCommand,
        environment
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
          <span className={styles.commandModeLabel}>
            <strong>系统生成</strong>
            <small>推荐</small>
          </span>
        </label>
        <label data-active={customEnabled || undefined}>
          <input
            type="radio"
            name="edge-command-mode"
            value="custom"
            checked={customEnabled}
            disabled={disabled}
            onChange={useCustomCommand}
          />
          <span className={styles.commandModeLabel}>
            <strong>自定义命令</strong>
            <small>高级</small>
          </span>
        </label>
      </div>

      <div className={styles.commandWorkspaceField}>{workspaceField}</div>

      {customEnabled ? (
        <section
          className={styles.customCommandPanel}
          aria-label="结构化 Edge 启动模板"
        >
          <div className={styles.commandPanelHeader}>
            <div>
              <strong>结构化启动模板</strong>
              <p>主进程使用 shell: false 启动，并在执行前再次请求确认。</p>
            </div>
            <div className={styles.commandPanelActions}>
              <button
                type="button"
                className={styles.commandTemplateButton}
                disabled={disabled || loadingGeneratedCommand}
                onClick={onLoadGeneratedCommand}
              >
                {loadingGeneratedCommand ? '正在读取…' : '使用系统模板'}
              </button>
            </div>
          </div>

          <label className={styles.field} htmlFor="edge-command-executable">
            <span className={styles.fieldLabel}>Edge 可执行文件</span>
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
                推荐选择所用 Conda 环境中的 unilab；Windows 仅支持绝对 .exe。
              </span>
            )}
          </label>

          <label className={styles.field} htmlFor="edge-command-working-directory">
            <span className={styles.fieldLabel}>工作目录</span>
            <span
              className={styles.pathEditor}
              data-invalid={submitted && Boolean(workingDirectoryError)}
              data-disabled={disabled}
            >
              <input
                id="edge-command-working-directory"
                className={styles.pathInput}
                value={config.customEdgeCommand.workingDirectory}
                placeholder="例如 {{workspace}} 或领域项目的绝对路径"
                maxLength={4_096}
                disabled={disabled}
                aria-invalid={submitted && Boolean(workingDirectoryError)}
                aria-describedby={workingDirectoryError
                  ? 'edge-command-working-directory-error'
                  : 'edge-command-working-directory-hint'}
                onChange={updateWorkingDirectory}
              />
              <button
                type="button"
                className={styles.pathBrowse}
                disabled={disabled}
                onClick={onChooseWorkingDirectory}
              >
                选择目录
              </button>
            </span>
            {submitted && workingDirectoryError ? (
              <span
                id="edge-command-working-directory-error"
                className={styles.fieldError}
              >
                {workingDirectoryError}
              </span>
            ) : (
              <span
                id="edge-command-working-directory-hint"
                className={styles.fieldHint}
              >
                必须是绝对目录；可使用受控占位符，不经过 cd 或 shell。
              </span>
            )}
          </label>

          <label className={styles.field} htmlFor="edge-command-arguments">
            <span className={styles.fieldLabel}>参数</span>
            <textarea
              id="edge-command-arguments"
              className={styles.commandArguments}
              value={argumentText}
              placeholder={'每行一个参数，例如：\n-m\nunilabos.app.main\n--workspace\n{{workspace}}'}
              maxLength={32_768}
              rows={7}
              disabled={disabled}
              spellCheck={false}
              aria-describedby="edge-command-arguments-hint"
              onChange={updateArguments}
            />
            <span id="edge-command-arguments-hint" className={styles.fieldHint}>
              每行一个参数；路径包含空格时无需添加引号。
            </span>
          </label>

          <label className={styles.field} htmlFor="edge-command-environment">
            <span className={styles.fieldLabel}>环境变量覆盖</span>
            <textarea
              id="edge-command-environment"
              className={styles.commandEnvironment}
              value={environmentText}
              placeholder={'每行一个 NAME=value，例如：\nMY_DEVICE_MODE=simulation'}
              maxLength={32_768}
              rows={3}
              disabled={disabled}
              spellCheck={false}
              aria-invalid={submitted && Boolean(environmentError)}
              aria-describedby={environmentError
                ? 'edge-command-environment-error'
                : 'edge-command-environment-hint'}
              onChange={updateEnvironment}
            />
            {submitted && environmentError ? (
              <span
                id="edge-command-environment-error"
                className={styles.fieldError}
              >
                {environmentError}
              </span>
            ) : (
              <span id="edge-command-environment-hint" className={styles.fieldHint}>
                每行 NAME=value；密码、令牌及启动器托管变量不能保存在这里。
              </span>
            )}
          </label>

          <details className={styles.commandAdvanced}>
            <summary>
              <span>占位符与命令预览</span>
              <small>查看最终参数边界和安全说明</small>
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
                <small>
                  工作目录：{config.customEdgeCommand.workingDirectory.trim()
                    || '<工作目录>'}
                </small>
              </div>

              <ul className={styles.commandCompatibilityNotes}>
                <li>程序和参数会分别启动，不经过 shell。</li>
                <li>Windows 仅支持绝对 .exe 路径，不执行 cmd、PowerShell 或脚本。</li>
                <li>启动器继续管理 Conda、运行数据库、18003/18004 端口和可观测性。</li>
                <li>启动前会由系统对话框确认程序、工作目录、参数与环境变量。</li>
              </ul>
            </div>
          </details>
        </section>
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
