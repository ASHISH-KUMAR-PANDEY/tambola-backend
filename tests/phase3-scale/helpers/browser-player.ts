/**
 * Browser Player Helper
 * Playwright-based player automation for UI testing
 * Used for full end-to-end browser interaction testing
 */

import { Page, Browser } from '@playwright/test';

export interface PlayerAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  token: string;
}

export interface BrowserPlayerOptions {
  browser: Browser;
  account: PlayerAccount;
  frontendUrl: string;
  debug?: boolean;
}

export class BrowserPlayer {
  private page: Page | null = null;
  private browser: Browser;
  private account: PlayerAccount;
  private frontendUrl: string;
  private debug: boolean;

  public gameId: string | null = null;

  constructor(options: BrowserPlayerOptions) {
    this.browser = options.browser;
    this.account = options.account;
    this.frontendUrl = options.frontendUrl;
    this.debug = options.debug || false;
  }

  private log(message: string, data?: any) {
    if (this.debug) {
      console.log(`[BrowserPlayer:${this.account.name}] ${message}`, data || '');
    }
  }

  async init(): Promise<void> {
    this.page = await this.browser.newPage();
    this.log('Browser page created');

    // Simulate mobile app flow: set app_user_id (this is what real users have)
    // The authStore prioritizes app_user_id over JWT tokens
    await this.page.addInitScript((authData) => {
      // THIS IS THE KEY: Mobile app users have app_user_id set
      localStorage.setItem('app_user_id', authData.id);

      // Set Zustand auth store with synthetic mobile app user
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          user: {
            id: authData.id,
            name: authData.name,
            email: `user_${authData.id}@app.com`,  // Synthetic email for mobile users
            role: 'PLAYER',
          },
          isAuthenticated: true,
          lastActivity: Date.now(),
        },
        version: 0,
      }));
    }, this.account);

    this.log('Mobile app user simulation: app_user_id set');
  }

  async navigateToGame(gameId: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    this.gameId = gameId;

    // Navigate directly to game with userId param (simulates mobile app deep link)
    const url = `${this.frontendUrl}/game/${gameId}?userId=${this.account.id}`;
    this.log(`Navigating to ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });

    // Handle name entry modal if it appears (mobile app onboarding)
    // Wait longer for modal to appear
    await this.page.waitForTimeout(2000);

    try {
      // Look for any visible input field in a modal
      const nameInput = await this.page.locator('input[type="text"]').first();
      const inputVisible = await nameInput.isVisible().catch(() => false);

      if (inputVisible) {
        this.log('Name modal detected, filling name');
        await nameInput.click();
        await nameInput.fill(this.account.name);

        // Click the button (try multiple possible texts)
        const buttonClicked = await Promise.race([
          this.page.locator('button').filter({ hasText: 'आगे' }).click().then(() => true).catch(() => false),
          this.page.locator('button').filter({ hasText: 'Proceed' }).click().then(() => true).catch(() => false),
          this.page.locator('button').filter({ hasText: 'Continue' }).click().then(() => true).catch(() => false),
        ]);

        if (buttonClicked) {
          this.log('Name modal submitted');
          await this.page.waitForTimeout(2000);
        }
      }
    } catch (e) {
      // No modal or error, continue
      this.log(`Modal handling: ${e}`);
    }

    // Wait for ticket to load
    await this.page.waitForSelector('text=Your Ticket', { timeout: 10000 });
    this.log('Game loaded, ticket visible');
  }

  async markNumber(number: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    // Find the cell with this number and click it
    const cellSelector = `button:has-text("${number}")`;

    try {
      await this.page.click(cellSelector, { timeout: 5000 });
      this.log(`Marked number: ${number}`);
    } catch (error) {
      throw new Error(`Failed to mark number ${number}: ${error}`);
    }
  }

  async claimWin(category: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    // Map category to button text
    const buttonMap: Record<string, string> = {
      EARLY_5: 'Claim Early 5',
      TOP_LINE: 'Claim Top Line',
      MIDDLE_LINE: 'Claim Middle Line',
      BOTTOM_LINE: 'Claim Bottom Line',
      FULL_HOUSE: 'Claim Full House',
    };

    const buttonText = buttonMap[category];
    if (!buttonText) throw new Error(`Unknown category: ${category}`);

    try {
      await this.page.click(`button:has-text("${buttonText}")`, { timeout: 5000 });
      this.log(`Clicked claim button: ${category}`);

      // Wait for result toast/modal
      await this.page.waitForTimeout(2000);
    } catch (error) {
      throw new Error(`Failed to claim ${category}: ${error}`);
    }
  }

  async getCalledNumbersCount(): Promise<number> {
    if (!this.page) throw new Error('Page not initialized');

    // Count called numbers from the called numbers grid
    const calledCells = await this.page.locator('[data-called="true"]').count();
    this.log(`Called numbers count: ${calledCells}`);
    return calledCells;
  }

  async getMarkedNumbersCount(): Promise<number> {
    if (!this.page) throw new Error('Page not initialized');

    // Count marked cells on ticket
    const markedCells = await this.page.locator('button[data-marked="true"]').count();
    this.log(`Marked numbers count: ${markedCells}`);
    return markedCells;
  }

  async getWinnersCount(): Promise<number> {
    if (!this.page) throw new Error('Page not initialized');

    // Check winners panel
    try {
      const winnersSection = await this.page.locator('text=Winners').count();
      if (winnersSection === 0) return 0;

      const winnerItems = await this.page.locator('[data-winner-item]').count();
      this.log(`Winners count: ${winnerItems}`);
      return winnerItems;
    } catch {
      return 0;
    }
  }

  async hasWonCategory(category: string): Promise<boolean> {
    if (!this.page) throw new Error('Page not initialized');

    // Check if UI shows "You won [category]"
    try {
      const wonText = await this.page.locator(`text=You won ${category}`).count();
      return wonText > 0;
    } catch {
      return false;
    }
  }

  async hardRefresh(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    this.log('Hard refresh...');
    await this.page.reload({ waitUntil: 'networkidle' });

    // Wait for ticket to reload
    await this.page.waitForSelector('text=Your Ticket', { timeout: 10000 });
    this.log('Hard refresh complete');
  }

  async leaveGame(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    // Click leave button
    try {
      await this.page.click('button:has-text("Leave Game")', { timeout: 5000 });
      this.log('Left game');
      this.gameId = null;
    } catch (error) {
      this.log('Leave button not found, navigating away');
      await this.page.goto(this.frontendUrl);
    }
  }

  async clickBackButton(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    this.log('Clicking browser back button');
    await this.page.goBack();
  }

  async clickForwardButton(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    this.log('Clicking browser forward button');
    await this.page.goForward();
  }

  async close(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
      this.log('Browser page closed');
    }
  }

  async screenshot(filename: string): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    await this.page.screenshot({ path: filename, fullPage: true });
    this.log(`Screenshot saved: ${filename}`);
  }

  async waitForTimeout(ms: number): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');
    await this.page.waitForTimeout(ms);
  }

  getPage(): Page | null {
    return this.page;
  }

  // Helper: Enable auto-mark by watching for called numbers
  async enableAutoMark(): Promise<void> {
    if (!this.page) throw new Error('Page not initialized');

    // This would require exposing called numbers updates in the UI
    // For now, this is a placeholder for future implementation
    this.log('Auto-mark enabled (manual marking required for now)');
  }
}
