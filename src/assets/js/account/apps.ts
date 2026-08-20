import dialogService from '../utils/dialog.js';
import {
  ConfirmedActionManager,
  type ConfirmedActionConfig,
  type ConfirmedActionDialog,
} from '../utils/confirmed-action.js';

export type AppsConfig = ConfirmedActionConfig;

export class AppsManager extends ConfirmedActionManager {
  public constructor(
    config: AppsConfig = {},
    dialog: ConfirmedActionDialog = dialogService
  ) {
    super('AppsManager', config, dialog);
  }
}

export function initializeAppsPage(): void {
  new AppsManager().initialize();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initializeAppsPage);
}
