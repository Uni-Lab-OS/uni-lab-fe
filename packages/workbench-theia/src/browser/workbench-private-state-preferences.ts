import type {
  PreferenceContribution,
  PreferenceSchemaService
} from '@theia/core/lib/common/preferences'
import { injectable } from '@theia/core/shared/inversify'

/**
 * Product defaults keep private runtime/Agent state outside every IDE consumer.
 * Explicit user preferences can still add exclusions but cannot make this state
 * part of the OS package generation or Git contract.
 */
@injectable()
export class WorkbenchPrivateStatePreferenceContribution
implements PreferenceContribution {
  initSchema(service: PreferenceSchemaService): Promise<void> {
    service.registerOverride('files.exclude', undefined, {
      '**/.git': true,
      '**/.svn': true,
      '**/.hg': true,
      '**/CVS': true,
      '**/.DS_Store': true,
      '**/.unilabos': true,
      '**/logs': true,
      '**/*.log': true
    })
    service.registerOverride('files.watcherExclude', undefined, {
      '**/.git/objects/**': true,
      '**/.git/subtree-cache/**': true,
      '**/.unilabos/**': true,
      '**/logs/**': true,
      '**/*.log': true
    })
    service.registerOverride('search.exclude', undefined, {
      '**/node_modules': true,
      '**/.unilabos/**': true,
      '**/logs/**': true,
      '**/*.log': true
    })
    service.registerOverride('python.analysis.exclude', undefined, [
      '**/.unilabos/**',
      '**/logs/**'
    ])
    return Promise.resolve()
  }
}
