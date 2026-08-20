import dialogService from '../utils/dialog.js';
import {
  ConfirmedActionManager,
  type ConfirmedActionConfig,
  type ConfirmedActionDialog,
} from '../utils/confirmed-action.js';

export type SessionsConfig = ConfirmedActionConfig;

export class SessionsManager extends ConfirmedActionManager {
  public constructor(
    config: SessionsConfig = {},
    dialog: ConfirmedActionDialog = dialogService
  ) {
    super('SessionsManager', config, dialog);
  }
}

export function initializeSessionsPage(): void {
  new SessionsManager().initialize();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initializeSessionsPage);
}
