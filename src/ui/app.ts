const blessed: any = require('neo-neo-blessed');
import { isExpired, loginWithBrowser, refreshAccessToken } from '../lib/auth.js';
import type { Account, Target } from '../lib/models.js';
import { fetchUsage, isUnauthorizedQuotaError } from '../lib/quota.js';
import { applyAccountToTargets, deleteManagedAccount, loadAccounts, persistAccount, upsertManagedAccount } from '../lib/store.js';
import { sameAccountIdentity, truncate } from '../lib/utils.js';
import { formatAccountDetails, formatAccountRow, helpText } from './formatters.js';

type ActionItem = {
  label: string;
  run: () => Promise<void>;
};

export class QuotaManagerApp {
  private readonly screen: any;
  private readonly headerBox: any;
  private readonly statusBox: any;
  private readonly listBox: any;
  private readonly detailsBox: any;
  private readonly footerBox: any;
  private readonly actionBox: any;
  private readonly actionList: any;
  private readonly helpBox: any;
  private readonly messageBox: any;
  private readonly confirmBox: any;
  private readonly busyBox: any;

  private accounts: Account[] = [];
  private selectedIndex = 0;
  private busy = false;
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
      tags: false,
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
      height: 3,
      border: 'line',
      label: ' Status ',
      content: 'Loading accounts...',
      style: {
        border: { fg: 'blue' },
      },
    });

    this.listBox = blessed.list({
      parent: this.screen,
      top: 6,
      left: 0,
      width: '42%',
      height: '100%-8',
      border: 'line',
      label: ' Accounts ',
      keys: true,
      vi: true,
      mouse: true,
      tags: false,
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

    this.detailsBox = blessed.box({
      parent: this.screen,
      top: 6,
      left: '42%',
      width: '58%',
      height: '100%-8',
      border: 'line',
      label: ' Details ',
      tags: false,
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      padding: {
        left: 1,
        right: 1,
      },
      style: {
        border: { fg: 'magenta' },
      },
      content: '',
    });

    this.footerBox = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      border: 'line',
      label: ' Shortcuts ',
      content: 'Enter actions | r refresh | R all | t token | a codex | o opencode | b both | n add | x delete | ? help | q quit',
      style: {
        border: { fg: 'yellow' },
      },
    });

    this.actionBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: '60%',
      border: 'line',
      label: ' Actions ',
      hidden: true,
      style: {
        border: { fg: 'cyan' },
        bg: 'black',
      },
    });

    this.actionList = blessed.list({
      parent: this.actionBox,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      keys: true,
      vi: true,
      mouse: true,
      border: 'line',
      style: {
        selected: { bg: 'blue', bold: true },
      },
      items: [],
    });

    this.helpBox = blessed.box({
      parent: this.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '70%',
      border: 'line',
      label: ' Help ',
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
      height: 7,
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
      if (this.hideOverlay()) {
        return;
      }
      this.exit();
    });

    this.screen.key(['?'], () => {
      if (this.helpBox.hidden) {
        this.showHelp();
      } else {
        this.hideOverlay();
      }
    });

    this.screen.key(['r'], () => {
      if (this.canHandleCommand()) {
        void this.refreshSelectedUsage(true);
      }
    });

    this.screen.key(['R'], () => {
      if (this.canHandleCommand()) {
        void this.refreshAllUsage();
      }
    });

    this.screen.key(['t'], () => {
      if (this.canHandleCommand()) {
        void this.refreshSelectedToken();
      }
    });

    this.screen.key(['a'], () => {
      if (this.canHandleCommand()) {
        void this.applySelectedTo(['codex']);
      }
    });

    this.screen.key(['o'], () => {
      if (this.canHandleCommand()) {
        void this.applySelectedTo(['opencode']);
      }
    });

    this.screen.key(['b'], () => {
      if (this.canHandleCommand()) {
        void this.applySelectedTo(['codex', 'opencode']);
      }
    });

    this.screen.key(['n'], () => {
      if (this.canHandleCommand()) {
        void this.addAccount();
      }
    });

    this.screen.key(['x'], () => {
      if (this.canHandleCommand()) {
        this.promptDeleteSelectedAccount();
      }
    });

    this.listBox.on('keypress', () => {
      this.selectedIndex = this.listBox.selected;
      this.renderMainPanels();
    });

    this.listBox.on('select', () => {
      if (this.accounts.length > 0 && !this.isOverlayOpen()) {
        this.openActionMenu();
      }
    });

    this.actionList.on('select', (_item: unknown, index: number) => {
      const action = this.actionItems[index];
      if (!action) {
        return;
      }
      this.hideOverlay();
      void action.run();
    });

    this.screen.key(['y', 'enter'], () => {
      if (!this.confirmBox.hidden && this.confirmAction) {
        const action = this.confirmAction;
        this.hideOverlay();
        void action();
      }
    });

    this.screen.key(['n'], () => {
      if (!this.confirmBox.hidden) {
        this.hideOverlay();
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
    this.renderMainPanels();

    if (this.accounts.length === 0) {
      this.setStatus('No accounts found. Press n to add one through browser login.');
    } else {
      this.setStatus(`Loaded ${this.accounts.length} account${this.accounts.length === 1 ? '' : 's'}.`);
    }
  }

  private resolveSelectedIndex(current?: Account): number {
    if (!current || this.accounts.length === 0) {
      return 0;
    }

    const matchIndex = this.accounts.findIndex((account) => sameAccountIdentity(account, current));
    return matchIndex >= 0 ? matchIndex : 0;
  }

  private renderMainPanels(): void {
    const listWidth = typeof this.listBox.width === 'number' ? this.listBox.width : 60;
    const listItems = this.accounts.length > 0
      ? this.accounts.map((account) => formatAccountRow(account, listWidth))
      : ['No accounts found. Press n to add one.'];
    this.listBox.setItems(listItems);
    if (this.accounts.length > 0) {
      this.listBox.select(this.selectedIndex);
      const selected = this.accounts[this.selectedIndex]!;
      this.detailsBox.setContent(formatAccountDetails(selected));
    } else {
      this.detailsBox.setContent('No account is selected.\n\nAdd one with browser login to get started.');
    }
    this.screen.render();
  }

  private currentAccount(): Account | undefined {
    return this.accounts[this.selectedIndex];
  }

  private canHandleCommand(): boolean {
    return !this.busy && !this.isOverlayOpen();
  }

  private isOverlayOpen(): boolean {
    return !this.actionBox.hidden || !this.helpBox.hidden || !this.messageBox.hidden || !this.confirmBox.hidden;
  }

  private hideOverlay(): boolean {
    let hidden = false;

    for (const box of [this.actionBox, this.helpBox, this.messageBox, this.confirmBox]) {
      if (!box.hidden) {
        box.hide();
        hidden = true;
      }
    }

    this.confirmAction = undefined;
    if (hidden) {
      this.listBox.focus();
      this.screen.render();
    }

    return hidden;
  }

  private showHelp(): void {
    this.helpBox.show();
    this.helpBox.focus();
    this.screen.render();
  }

  private showMessage(message: string, title = 'Message'): void {
    this.messageBox.setLabel(` ${title} `);
    this.messageBox.setContent(message);
    this.messageBox.show();
    this.messageBox.focus();
    this.screen.render();
  }

  private openActionMenu(): void {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    this.actionItems = [
      { label: 'Refresh usage', run: async () => this.refreshSelectedUsage(true) },
      { label: 'Refresh token', run: async () => this.refreshSelectedToken() },
      { label: 'Apply to Codex', run: async () => this.applySelectedTo(['codex']) },
      { label: 'Apply to OpenCode', run: async () => this.applySelectedTo(['opencode']) },
      { label: 'Apply to both', run: async () => this.applySelectedTo(['codex', 'opencode']) },
      { label: 'Add account via browser login', run: async () => this.addAccount() },
      { label: 'Delete managed copy', run: async () => this.promptDeleteSelectedAccount() },
      { label: 'Reload accounts', run: async () => this.reloadAccounts(account) },
    ];

    this.actionList.setItems(this.actionItems.map((item) => item.label));
    this.actionList.select(0);
    this.actionBox.show();
    this.actionList.focus();
    this.screen.render();
  }

  private promptDeleteSelectedAccount(): void {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    this.confirmAction = async () => {
      await this.runTask(`Deleting ${account.label}...`, async () => {
        await deleteManagedAccount(account);
        await this.reloadAccounts();
        this.setStatus(`Deleted managed copy of ${account.label}.`);
      });
    };

    this.confirmBox.setContent(
      `Delete the managed copy of ${account.label}?\n\nThis does not erase the currently active Codex/OpenCode auth files.\n\nPress y or Enter to confirm, n or Esc to cancel.`,
    );
    this.confirmBox.show();
    this.confirmBox.focus();
    this.screen.render();
  }

  private async addAccount(): Promise<void> {
    await this.runTask('Waiting for browser login...', async () => {
      const account = await loginWithBrowser((status) => {
        if (status.browserOpenFailed) {
          this.showMessage(
            `Browser open failed.\n\nOpen this URL manually and leave this terminal window running:\n\n${status.authUrl}`,
            'Manual Login',
          );
        } else {
          this.setStatus('Browser opened for OpenAI login.');
        }
      });

      await upsertManagedAccount(account);
      await this.reloadAccounts(account);
      this.setStatus(`Added ${account.label}.`);
    });
  }

  private async refreshSelectedUsage(notify: boolean): Promise<void> {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    await this.runTask(`Refreshing usage for ${account.label}...`, async () => {
      await this.refreshUsageForAccount(account);
      this.renderMainPanels();
      if (notify) {
        this.setStatus(`Refreshed usage for ${account.label}.`);
      }
    });
  }

  private async refreshAllUsage(): Promise<void> {
    if (this.accounts.length === 0) {
      return;
    }

    await this.runTask('Refreshing usage for all accounts...', async () => {
      for (const account of this.accounts) {
        this.setStatus(`Refreshing ${account.label}...`);
        try {
          await this.refreshUsageForAccount(account);
        } catch {
          // Per-account failure is already attached to the account state.
        }
        this.renderMainPanels();
      }
      this.setStatus('Finished refreshing all accounts.');
    });
  }

  private async refreshSelectedToken(): Promise<void> {
    const account = this.currentAccount();
    if (!account) {
      return;
    }

    await this.runTask(`Refreshing token for ${account.label}...`, async () => {
      await refreshAccessToken(account);
      await persistAccount(account);
      this.renderMainPanels();
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
      await this.reloadAccounts(account);
      this.setStatus(`Applied ${account.label} to ${label}.`);
    });
  }

  private async refreshUsageForAccount(account: Account): Promise<void> {
    let tokenUpdated = false;

    if (isExpired(account) && account.refreshToken) {
      await refreshAccessToken(account);
      tokenUpdated = true;
    }

    try {
      account.usage = await fetchUsage(account.accessToken, account.accountId);
      account.lastError = undefined;
    } catch (error) {
      if (isUnauthorizedQuotaError(error) && account.refreshToken) {
        await refreshAccessToken(account);
        tokenUpdated = true;
        account.usage = await fetchUsage(account.accessToken, account.accountId);
        account.lastError = undefined;
      } else {
        account.lastError = this.errorMessage(error);
        throw error;
      }
    }

    if (tokenUpdated) {
      await persistAccount(account);
    }
  }

  private async runTask(label: string, task: () => Promise<void>): Promise<void> {
    if (this.busy) {
      return;
    }

    this.busy = true;
    this.busyBox.setContent(label);
    this.busyBox.show();
    this.screen.render();

    try {
      await task();
    } catch (error) {
      const message = this.errorMessage(error);
      this.setStatus(message);
      this.showMessage(message, 'Error');
    } finally {
      this.busy = false;
      this.busyBox.hide();
      this.listBox.focus();
      this.screen.render();
    }
  }

  private setStatus(message: string): void {
    this.statusBox.setContent(truncate(message, 400));
    this.screen.render();
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private exit(): void {
    this.screen.destroy();
    process.exit(0);
  }
}
