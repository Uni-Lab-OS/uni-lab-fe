import {
  CommonCommands,
  type FrontendApplication,
  type FrontendApplicationContribution
} from '@theia/core/lib/browser'
import { CommandRegistry, type Disposable } from '@theia/core/lib/common'
import { inject, injectable } from '@theia/core/shared/inversify'

const NEW_TERMINAL_COMMAND_ID = 'terminal:new'

@injectable()
export class UniLabBottomPanelContribution
implements FrontendApplicationContribution {
  @inject(CommandRegistry)
  protected readonly commands!: CommandRegistry

  protected bottomPanelToggleHandler: Disposable | undefined

  onStart(app: FrontendApplication): void {
    // Theia's generic toggle can expand an empty dock after its final tab was
    // closed. In that one state, make the status-bar entry useful by creating
    // a fresh terminal; every non-empty panel keeps Theia's native behavior.
    this.bottomPanelToggleHandler = this.commands.registerHandler(
      CommonCommands.TOGGLE_BOTTOM_PANEL.id,
      {
        isEnabled: () =>
          !app.shell.isExpanded('bottom') &&
          app.shell.getWidgets('bottom').length === 0,
        execute: () => this.commands.executeCommand(NEW_TERMINAL_COMMAND_ID)
      }
    )
  }

  onStop(): void {
    this.bottomPanelToggleHandler?.dispose()
    this.bottomPanelToggleHandler = undefined
  }
}
