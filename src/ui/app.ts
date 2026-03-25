const blessed: any = require('neo-neo-blessed');
import { refreshAccountUsage, formatBulkRefreshStatus, userFacingError } from '../lib/account-refresh.js';
import { loginWithBrowser, refreshAccessToken } from '../lib/auth.js';
import { getLoggerHealth, formatErrorForLog, logError, logInfo, readLogs } from '../lib/log.js';
import type { Account, Target } from '../lib/models.js';
import { applyAccountToTargets, deleteManagedAccount, loadAccounts, persistAccount, upsertManagedAccount } from '../lib/store.js';
import { sameAccountIdentity, truncate } from '../lib/utils.js';
import {
  formatAccountRow,
  formatAccountWorkspaceDetails,
  formatAccountWorkspaceSummary,
  helpText,
} from './formatters.js';

type ActionItem = {
  label: string;
  run: () => Promise<void>;
};

type TaskOptions = {
  showErrorDialog?: boolean;
};

export class QuotaManagerApp {
  private readonly screen: any;
  private readonly headerBox: any;
  private readonly statusBox: any;
  private readonly listBox: any;
  private readonly footerBox: any;
  private readonly workspaceBox: any;
  private readonly workspaceSummaryBox: any;
  private readonly workspaceDetailBox: any;
  private readonly workspaceActionList: any;
  private readonly helpBox: any;
  private readonly logBox: any;
  private readonly messageBox: any;
  private readonly confirmBox: any;
  private readonly busyBox: any;

  private accounts: Account[] = [];
  private selectedIndex = 0;
  private busy = false;
  private workspaceFocusIndex = 0;
  private actionItems: ActionItem[] = [];
  private confirmAction?: () => Promise<void>;

  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      autoPadding: true,
      title: 'Codex Quota Manager',
    });

    this.headerBox = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      border: 'line',
      label: ' Codex Quota Manager ',
      content: 'Cross-platform TUI for Codex account switching and quota checks',
      style: {
        border: { fg: 'cyan' },
      },
    });

    this.statusBox = blessed.box({
      parent: this.screen,
      top: 3,
      left: 0,
      width: '100%',
      height: 1,
      content: 'Status: Loading accounts...',
      style: {
        fg: 'cyan',
        bold: true,
      },
    });

    this.listBox = blessed.list({
      parent: this.screen,
      top: 4,
      left: 0,
      width: '100%',
      height: '100%-5',
      border: 'line',
      label: ' Accounts ',
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: ' ',
        style: { inverse: true },
      },
      style: {
        border: { fg: 'green' },
        item: { fg: 'white' },
        selected: { bg: 'blue', fg: 'white', bold: true },
      },
      items: [],
    });

    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: 'Press h for help | Enter for workspace | l for logs | q to quit',
      style: {
        fg: 'yellow',
      },
    });

    this.workspaceBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '86%',
      height: '80%',
      border: 'line',
      label: ' Account Workspace ',
      hidden: true,
      style: {
        border: { fg: 'cyan' },
        bg: 'black',
      },
    });

    this.workspaceSummaryBox = blessed.box({
      parent: this.workspaceBox,
      top: 0,
      left: 0,
      width: '100%',
      height: 11,
      border: 'line',
      label: ' Summary ',
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        border: { fg: 'magenta' },
      },
    });

    this.workspaceActionList = blessed.list({
      parent: this.workspaceBox,
      top: 11,
      left: 0,
      width: '34%',
      height: '100%-11',
      border: 'line',
      label: ' Actions ',
      keys: true,
      vi: true,
      mouse: true,
      scrollbar: {
        ch: ' ',
        style: { inverse: true },
      },
      style: {
        border: { fg: 'green' },
        item: { fg: 'white' },
        selected: { bg: 'blue', fg: 'white', bold: true },
      },
      items: [],
    });

    this.workspaceDetailBox = blessed.box({
      parent: this.workspaceBox,
      top: 11,
      left: '34%',
      width: '66%',
      height: '100%-11',
      border: 'line',
      label: ' Quota & Status ',
      scrollable: true,
      alwaysScroll: true,
      mouse: true,
      keys: true,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        border: { fg: 'magenta' },
      },
    });

    this.helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '70%',
      border: 'line',
      label: ' Shortcuts ',
      hidden: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      padding: {
        left: 1,
        right: 1,
      },
      content: helpText(),
      style: {
        border: { fg: 'white' },
      },
    });

    this.logBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '75%',
      border: 'line',
      label: ' Logs ',
      hidden: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        border: { fg: 'yellow' },
      },
    });

    this.messageBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '50%',
      border: 'line',
      label: ' Message ',
      hidden: true,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        border: { fg: 'red' },
      },
    });

    this.confirmBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 8,
      border: 'line',
      label: ' Confirm ',
      hidden: true,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        border: { fg: 'red' },
      },
    });

    this.busyBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '50%',
      height: 5,
      border: 'line',
      label: ' Working ',
      hidden: true,
      align: 'center',
      valign: 'middle',
      style: {
        border: { fg: 'yellow' },
      },
    });

    this.bindEvents();
  }

  async start(): Promise<void> {
    await this.reloadAccounts();
    this.listBox.focus();
    this.screen.render();
  }

  private bindEvents(): void {
    this.screen.key(['q', 'C-c'], () => {
      this.exit();
    });

    this.screen.key(['escape'], () => {
      if (this.busy) {
        return;
      }
      if (this.hideTopOverlay()) {
        return;
      }
      this.exit();
    });

    this.screen.key(['h', '?'], () => {
      if (this.busy) {
        return;
      }
      if (!this.helpBox.hidden) {
        this.hideSpecificOverlay(this.helpBox);
        return;
      }
      this.showHelp();
    });

    this.screen.key(['l'], () => {
      if (this.busy) {
        return;
      }
      if (!this.logBox.hidden) {
        this.hideSpecificOverlay(this.logBox);
        return;
      }
      void this.showLogs();
    });

    this.screen.key(['r'], () => {
      if (this.canHandleAccountCommand()) {
        void this.refreshSelectedUsage(true);
      }
    });

    this.screen.key(['R'], () => {
      if (this.canHandleAccountCommand()) {
        void this.refreshAllUsage();
      }
    });

    this.screen.key(['t'], () => {
      if (this.canHandleAccountCommand()) {
        void this.refreshSelectedToken();
      }
    });

    this.screen.key(['a'], () => {
      if (this.canHandleAccountCommand()) {
        void this.applySelectedTo(['codex']);
      }
    });

    this.screen.key(['o'], () => {
      if (this.canHandleAccountCommand()) {
        void this.applySelectedTo(['opencode']);
      }
    });

    this.screen.key(['b'], () => {
      if (this.canHandleAccountCommand()) {
        void this.applySelectedTo(['codex', 'opencode']);
      }
    });

    this.screen.key(['n'], () => {
      if (!this.confirmBox.hidden) {
        this.hideSpecificOverlay(this.confirmBox);
        return;
      }
      if (this.canHandleListCommand()) {
        void this.addAccount();
      }
    });

    this.screen.key(['x'], () => {
      if (this.canHandleAccountCommand()) {
        this.promptDeleteSelectedAccount();
      }
    });

    this.screen.key(['tab'], () => {
      if (!this.busy && !this.workspaceBox.hidden && this.noBlockingOverlayAboveWorkspace()) {
        this.advanceWorkspaceFocus(1);
      }
    });

    this.screen.key(['S-tab'], () => {
      if (!this.busy && !this.workspaceBox.hidden && this.noBlockingOverlayAboveWorkspace()) {
        this.advanceWorkspaceFocus(-1);
      }
    });

    this.screen.key(['enter'], () => {
      if (!this.confirmBox.hidden && this.confirmAction) {
        const action = this.confirmAction;
        this.hideSpecificOverlay(this.confirmBox);
        void action();
      }
    });

    this.screen.key(['y'], () => {
      if (!this.confirmBox.hidden && this.confirmAction) {
        const action = this.confirmAction;
        this.hideSpecificOverlay(this.confirmBox);
        void action();
      }
    });

    this.listBox.key(['enter'], () => {
      if (!this.busy && this.accounts.length > 0 && !this.isTransientOverlayOpen()) {
        this.openWorkspace();
      }
    });

    this.listBox.on('keypress', () => {
      this.selectedIndex = this.listBox.selected;
      this.renderMainView();
      if (!this.workspaceBox.hidden) {
        this.renderWorkspace();
      }
    });

    this.workspaceActionList.on('select', (_item: unknown, index: number) => {
      const action = this.actionItems[index];
      if (action) {
        void action.run();
      }
    });
  }

  private async reloadAccounts(preferredAccount?: Account): Promise<void> {
    const previousAccounts = this.accounts;
    const current = preferredAccount ?? this.currentAccount();
    const loadedAccounts = await loadAccounts();

    for (const account of loadedAccounts) {
      const previous = previousAccounts.find((candidate) => sameAccountIdentity(candidate, account) || candidate.key === account.key);
      if (previous) {
        account.usage = previous.usage;
        account.lastError = previous.lastError;
      }
    }

    this.accounts = loadedAccounts;
    this.selectedIndex = this.resolveSelectedIndex(current);
    this.renderMainView();

    if (this.accounts.length === 0) {
      this.hideSpecificOverlay(this.workspaceBox);
      this.setStatus('No accounts found. Press n to add one through browser login.');
      return;
    }

    if (!this.workspaceBox.hidden) {
      this.renderWorkspace();
    }

    this.setStatus(`Loaded ${this.accounts.length} account${this.accounts.length === 1 ? '' : 's'}.`);
  }

  private resolveSelectedIndex(current?: Account): number {
    if (!current || this.accounts.length === 0) {
      return 0;
    }

    const matchIndex = this.accounts.findIndex((account) => sameAccountIdentity(account, current));
    return matchIndex >= 0 ? matchIndex : 0;
  }

  private renderMainView(): void {
    const screenWidth = typeof this.screen.width === 'number' ? this.screen.width : 120;
    const listItems = this.accounts.length > 0
      ? this.accounts.map((account) => formatAccountRow(account, screenWidth - 6))
      : ['No accounts found. Press n to add one.'];

    this.listBox.setItems(listItems);
    if (this.accounts.length > 0) {
      this.listBox.select(this.selectedIndex);
    }

    this.screen.render();
  }

  private renderWorkspace(): void {
    const account = this.currentAccount();
    if (!account) {
      this.hideSpecificOverlay(this.workspaceBox);
      return;
    }

    this.workspaceBox.setLabel(` Workspace: ${truncate(account.label || account.email || account.accountId || 'Account', 50)} `);
    this.workspaceSummaryBox.setContent(formatAccountWorkspaceSummary(account));
    this.workspaceDetailBox.setContent(formatAccountWorkspaceDetails(account));

    this.actionItems = this.buildWorkspaceActions(account);
    this.workspaceActionList.setItems(this.actionItems.map((item) => item.label));
    if (this.actionItems.length > 0) {
      this.workspaceActionList.select(0);
    }

    if (this.workspaceBox.hidden) {
      this.workspaceBox.show();
    }

    this.focusActiveElement();
    this.screen.render();
  }

  private buildWorkspaceActions(account: Account): ActionItem[] {
    const items: ActionItem[] = [
      { label: 'Refresh usage', run: async () => this.refreshSelectedUsage(true) },
      { label: 'Refresh token', run: async () => this.refreshSelectedToken() },
      { label: 'Apply to Codex', run: async () => this.applySelectedTo(['codex']) },
      { label: 'Apply to OpenCode', run: async () => this.applySelectedTo(['opencode']) },
      { label: 'Apply to both', run: async () => this.applySelectedTo(['codex', 'opencode']) },
      { label: 'Reload accounts', run: async () => this.reloadSelectedAccount() },
      { label: 'View logs', run: async () => this.showLogs() },
    ];

    if (account.sources.includes('managed')) {
      items.push({ label: 'Delete managed copy', run: async () => this.promptDeleteSelectedAccount() });
    }

    items.push({ label: 'Close workspace', run: async () => this.closeWorkspace() });
    return items;
  }

  private currentAccount(): Account | undefined {
    return this.accounts[this.selectedIndex];
  }

  private canHandleListCommand(): boolean {
    return !this.busy && !this.isTransientOverlayOpen();
  }

  private canHandleAccountCommand(): boolean {
    return !this.busy && Boolean(this.currentAccount()) && !this.hasBlockingOverlay();
  }

  private isTransientOverlayOpen(): boolean {
    return !this.workspaceBox.hidden || !this.helpBox.hidden || !this.logBox.hidden || !this.messageBox.hidden || !this.confirmBox.hidden;
  }

  private hasBlockingOverlay(): boolean {
    return !this.helpBox.hidden || !this.logBox.hidden || !this.messageBox.hidden || !this.confirmBox.hidden;
  }

  private noBlockingOverlayAboveWorkspace(): boolean {
    return !this.hasBlockingOverlay() && !this.workspaceBox.hidden;
  }

  private hideTopOverlay(): boolean {
    if (!this.confirmBox.hidden) {
      return this.hideSpecificOverlay(this.confirmBox);
    }
    if (!this.messageBox.hidden) {
      return this.hideSpecificOverlay(this.messageBox);
    }
    if (!this.logBox.hidden) {
      return this.hideSpecificOverlay(this.logBox);
    }
    if (!this.helpBox.hidden) {
      return this.hideSpecificOverlay(this.helpBox);
    }
    if (!this.workspaceBox.hidden) {
      return this.hideSpecificOverlay(this.workspaceBox);
    }
    return false;
  }

  private hideSpecificOverlay(box: any): boolean {
    if (box.hidden) {
      return false;
    }

    box.hide();
    if (box === this.confirmBox) {
      this.confirmAction = undefined;
    }
    if (box === this.workspaceBox) {
      this.workspaceFocusIndex = 0;
    }

    this.focusActiveElement();
    this.screen.render();
    return true;
  }

  private focusActiveElement(): void {
    if (!this.confirmBox.hidden) {
      this.confirmBox.focus();
      return;
    }
    if (!this.messageBox.hidden) {
      this.messageBox.focus();
      return;
    }
    if (!this.logBox.hidden) {
      this.logBox.focus();
      return;
    }
    if (!this.helpBox.hidden) {
      this.helpBox.focus();
      return;
    }
    if (!this.workspaceBox.hidden) {
      this.workspaceFocusableElement().focus();
      return;
    }
    this.listBox.focus();
  }

  private advanceWorkspaceFocus(direction: number): void {
    const focusable = this.workspaceFocusable();
    this.workspaceFocusIndex = (this.workspaceFocusIndex + direction + focusable.length) % focusable.length;
    this.focusActiveElement();
    this.screen.render();
  }

  private workspaceFocusable(): any[] {
    return [this.workspaceActionList, this.workspaceDetailBox, this.workspaceSummaryBox];
  }

  private workspaceFocusableElement(): any {
    return this.workspaceFocusable()[this.workspaceFocusIndex] ?? this.workspaceActionList;
  }

  private showHelp(): void {
    this.helpBox.setContent(helpText());
    this.helpBox.show();
    this.helpBox.focus();
    this.screen.render();
  }

  private async showLogs(): Promise<void> {
    await this.runTask('Loading logs...', async () => {
      const logText = await readLogs();
      this.logBox.setContent(logText);
      this.logBox.setScrollPerc(100);
      this.logBox.show();
      this.setStatus('Loaded application logs.');
    });
  }

  private showMessage(message: string, title = 'Message'): void {
    this.messageBox.setLabel(` ${title} `);
    this.messageBox.setContent(message);
    this.messageBox.show();
    this.messageBox.focus();
    this.screen.render();
  }

  private openWorkspace(): void {
    if (!this.currentAccount()) {
      return;
    }
    this.workspaceFocusIndex = 0;
    this.renderWorkspace();
  }

  private closeWorkspace(): Promise<void> {
    this.hideSpecificOverlay(this.workspaceBox);
    return Promise.resolve();
  }

  private async reloadSelectedAccount(): Promise<void> {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    await this.runTask(`Reloading ${account.label}...`, async () => {
      await this.reloadAccounts(account);
      this.setStatus(`Reloaded ${account.label}.`);
    });
  }

  private promptDeleteSelectedAccount(): void {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    if (!account.sources.includes('managed')) {
      this.setStatus(`${account.label} is only discovered from external auth files and has no manager-owned copy to delete.`);
      return;
    }

    this.confirmAction = async () => {
      await this.runTask(`Deleting ${account.label}...`, async () => {
        await deleteManagedAccount(account);
        await this.reloadAccounts(account);

        const remaining = this.accounts.find((candidate) => sameAccountIdentity(candidate, account));
        if (remaining) {
          this.setStatus(`Removed ${account.label} from the manager. It is still available from external auth.`);
        } else {
          this.setStatus(`Removed ${account.label} from the manager.`);
        }
      });
    };

    this.confirmBox.setContent(
      `Delete the manager-owned copy of ${account.label}?\n\nThis will not change the current Codex/OpenCode auth files.\n\nPress y or Enter to confirm, n or Esc to cancel.`,
    );
    this.confirmBox.show();
    this.confirmBox.focus();
    this.screen.render();
  }

  private async addAccount(): Promise<void> {
    await this.runTask('Waiting for browser login...', async () => {
      logInfo('ui.add-account', 'Starting add-account flow.');
      const account = await loginWithBrowser((status) => {
        this.setStatus('Login URL ready. Complete the sign-in flow in your browser.');
        if (status.browserOpenFailed) {
          this.showMessage(
            `Browser open failed.\n\nOpen this URL manually and leave this terminal window running:\n\n${status.authUrl}`,
            'Manual Login',
          );
        }
      });

      this.hideSpecificOverlay(this.messageBox);
      const existingWorkspace = this.accounts.find((candidate) => sameAccountIdentity(candidate, account));
      const result = await upsertManagedAccount(account);
      await this.reloadAccounts(account);

      logInfo('ui.add-account', 'Account added via browser login.', {
        accountId: account.accountId,
        email: account.email || undefined,
      });

      if (existingWorkspace || (result.action === 'updated' && result.matchedBy === 'accountId')) {
        this.setStatus(`This workspace already matches ${account.email || account.label}. Stored credentials were refreshed.`);
      } else {
        this.setStatus(`Added ${account.label}.`);
      }
    });
  }

  private async refreshSelectedUsage(notify: boolean): Promise<void> {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    await this.runTask(`Refreshing usage for ${account.label}...`, async () => {
      const tokenSnapshot = this.captureTokenSnapshot(account);

      try {
        const result = await refreshAccountUsage(account);
        if (result.tokenUpdated) {
          await persistAccount(account);
        }
      } catch (error) {
        await this.persistTokensAfterFailedQuotaRefresh(account, tokenSnapshot);
        this.renderMainView();
        if (!this.workspaceBox.hidden) {
          this.renderWorkspace();
        }
        throw error;
      }

      this.renderMainView();
      if (!this.workspaceBox.hidden) {
        this.renderWorkspace();
      }
      if (notify) {
        this.setStatus(`Refreshed usage for ${account.label}.`);
      }
    }, { showErrorDialog: false });
  }

  private async refreshAllUsage(): Promise<void> {
    if (this.accounts.length === 0) {
      return;
    }

    await this.runTask('Refreshing usage for all accounts...', async () => {
      let failed = 0;

      for (const account of this.accounts) {
        this.setStatus(`Refreshing ${account.label}...`);
        const tokenSnapshot = this.captureTokenSnapshot(account);
        try {
          const result = await refreshAccountUsage(account);
          if (result.tokenUpdated) {
            await persistAccount(account);
          }
        } catch {
          failed += 1;
          await this.persistTokensAfterFailedQuotaRefresh(account, tokenSnapshot);
        }
        this.renderMainView();
        if (!this.workspaceBox.hidden) {
          this.renderWorkspace();
        }
      }

      this.setStatus(formatBulkRefreshStatus(this.accounts.length, failed));
    });
  }

  private async refreshSelectedToken(): Promise<void> {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    await this.runTask(`Refreshing token for ${account.label}...`, async () => {
      await refreshAccessToken(account);
      account.lastError = undefined;
      await persistAccount(account);
      this.renderMainView();
      if (!this.workspaceBox.hidden) {
        this.renderWorkspace();
      }
      this.setStatus(`Refreshed token for ${account.label}.`);
    });
  }

  private async applySelectedTo(targets: Target[]): Promise<void> {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    const label = targets.join(' + ');
    await this.runTask(`Applying ${account.label} to ${label}...`, async () => {
      await applyAccountToTargets(account, targets);
      await upsertManagedAccount(account);
      await this.reloadAccounts(account);
      this.setStatus(`Applied ${account.label} to ${label}.`);
    });
  }

  private async runTask(label: string, task: () => Promise<void>, options: TaskOptions = {}): Promise<boolean> {
    if (this.busy) {
      return false;
    }

    this.busy = true;
    this.busyBox.setContent(label);
    this.busyBox.show();
    this.screen.render();

    try {
      await task();
      return true;
    } catch (error) {
      const message = userFacingError(error);
      logError('ui.task', 'Task failed.', { label, error: formatErrorForLog(error) });
      this.setStatus(message);
      if (options.showErrorDialog !== false) {
        this.showMessage(message, 'Error');
      }
      return false;
    } finally {
      this.busy = false;
      this.busyBox.hide();
      this.focusActiveElement();
      this.screen.render();
    }
  }

  private setStatus(message: string): void {
    const loggerHealth = getLoggerHealth();
    const suffix = loggerHealth.healthy || !loggerHealth.message
      ? ''
      : ` | ${truncate(loggerHealth.message, 90)}`;
    this.statusBox.setContent(`Status: ${truncate(message, 220)}${suffix}`);
    this.screen.render();
  }

  private captureTokenSnapshot(account: Account): { accessToken: string; refreshToken: string; idToken: string; expiresAt?: number } {
    return {
      accessToken: account.accessToken,
      refreshToken: account.refreshToken,
      idToken: account.idToken,
      expiresAt: account.expiresAt?.getTime(),
    };
  }

  private async persistTokensAfterFailedQuotaRefresh(
    account: Account,
    previous: { accessToken: string; refreshToken: string; idToken: string; expiresAt?: number },
  ): Promise<void> {
    const tokensChanged = account.accessToken !== previous.accessToken
      || account.refreshToken !== previous.refreshToken
      || account.idToken !== previous.idToken
      || account.expiresAt?.getTime() !== previous.expiresAt;

    if (!tokensChanged) {
      return;
    }

    try {
      await persistAccount(account);
    } catch (error) {
      logError('ui.persist-after-refresh-failure', 'Persisting refreshed tokens after quota failure failed.', {
        accountId: account.accountId,
        error: formatErrorForLog(error),
      });
    }
  }

  private exit(): void {
    this.screen.destroy();
    process.exit(0);
  }
}
