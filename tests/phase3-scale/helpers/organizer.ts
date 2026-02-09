/**
 * Organizer Helper
 * Combines browser (for UI) and socket (for events) to control game as organizer
 */

import { Browser, Page } from '@playwright/test';
import { io, Socket } from 'socket.io-client';

export interface OrganizerAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  token: string;
}

export interface OrganizerOptions {
  browser?: Browser;
  account: OrganizerAccount;
  backendUrl: string;
  frontendUrl?: string;
  debug?: boolean;
}

export class Organizer {
  private socket: Socket | null = null;
  private page: Page | null = null;
  private browser: Browser | undefined;
  private account: OrganizerAccount;
  private backendUrl: string;
  private frontendUrl: string | undefined;
  private debug: boolean;

  public gameId: string | null = null;
  private calledNumbersSet: Set<number> = new Set();

  constructor(options: OrganizerOptions) {
    this.browser = options.browser;
    this.account = options.account;
    this.backendUrl = options.backendUrl;
    this.frontendUrl = options.frontendUrl;
    this.debug = options.debug || false;
  }

  private log(message: string, data?: any) {
    if (this.debug) {
      console.log(`[Organizer:${this.account.name}] ${message}`, data || '');
    }
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.backendUrl, {
        auth: { userId: this.account.id },
        transports: ['polling'],
      });

      this.socket.on('connect', () => {
        this.log('Socket connected');
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        reject(error);
      });

      setTimeout(() => {
        if (!this.socket?.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  async initBrowser(): Promise<void> {
    if (!this.browser || !this.frontendUrl) {
      throw new Error('Browser and frontendUrl required for UI operations');
    }

    this.page = await this.browser.newPage();

    // Set localStorage with auth token
    await this.page.addInitScript((authData) => {
      localStorage.setItem('auth-storage', JSON.stringify({
        state: {
          user: { id: authData.id, name: authData.name, email: authData.email },
          token: authData.token,
        },
      }));
    }, this.account);

    this.log('Browser initialized');
  }

  async createGame(prizes?: any): Promise<string> {
    const API_URL = `${this.backendUrl}/api/v1`;

    // Reset called numbers for new game
    this.calledNumbersSet.clear();

    const defaultPrizes = {
      early5: 100,
      topLine: 200,
      middleLine: 200,
      bottomLine: 200,
      fullHouse: 500,
    };

    const response = await fetch(`${API_URL}/games`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.account.token}`,
      },
      body: JSON.stringify({
        scheduledTime: new Date().toISOString(),
        prizes: prizes || defaultPrizes,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to create game: ${response.status}`);
    }

    const game = await response.json();
    this.gameId = game.id;
    this.log(`Game created: ${this.gameId}`);
    return this.gameId;
  }

  async joinGame(gameId: string): Promise<void> {
    if (!this.socket) throw new Error('Socket not connected');

    this.gameId = gameId;

    return new Promise((resolve, reject) => {
      this.socket!.emit('game:join', { gameId });

      this.socket!.once('game:joined', () => {
        this.log(`Joined game: ${gameId}`);
        resolve();
      });

      this.socket!.once('game:error', (error) => {
        reject(new Error(error.message || 'Failed to join game'));
      });

      setTimeout(() => reject(new Error('Join timeout')), 10000);
    });
  }

  async startGame(): Promise<void> {
    if (!this.socket || !this.gameId) {
      throw new Error('Not in a game');
    }

    return new Promise((resolve, reject) => {
      this.socket!.emit('game:start', { gameId: this.gameId });

      this.socket!.once('game:started', () => {
        this.log('Game started');
        resolve();
      });

      this.socket!.once('game:error', (error) => {
        reject(new Error(error.message || 'Failed to start game'));
      });

      setTimeout(() => reject(new Error('Start timeout')), 10000);
    });
  }

  async callNumber(number: number): Promise<void> {
    if (!this.socket || !this.gameId) {
      throw new Error('Not in a game');
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Call number ${number} timeout - no acknowledgment`));
      }, 5000);

      // Use callback acknowledgment instead of listening for broadcast
      // This bypasses the broken Socket.IO Redis adapter broadcast issue
      this.socket!.emit('game:callNumber', { gameId: this.gameId, number }, (response: any) => {
        clearTimeout(timeoutId);

        if (response && response.success) {
          this.calledNumbersSet.add(number);
          this.log(`Number called: ${number}`);
          resolve();
        } else {
          reject(new Error(`Call number ${number} failed: ${response?.error || 'Unknown error'}`));
        }
      });
    });
  }

  async callNumbers(numbers: number[], delayMs: number = 1000): Promise<void> {
    for (const number of numbers) {
      await this.callNumber(number);
      await this.sleep(delayMs);
    }
  }

  async callRandomNumbers(count: number, delayMs: number = 1000): Promise<number[]> {
    const calledNumbers: number[] = [];
    // Only pick from numbers that haven't been called yet
    const available = Array.from({ length: 90 }, (_, i) => i + 1)
      .filter(n => !this.calledNumbersSet.has(n));

    if (available.length < count) {
      throw new Error(`Not enough numbers available (need ${count}, have ${available.length})`);
    }

    // Shuffle
    for (let i = available.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [available[i], available[j]] = [available[j], available[i]];
    }

    const numbersToCall = available.slice(0, count);

    for (const number of numbersToCall) {
      await this.callNumber(number);
      // callNumber() already adds to calledNumbersSet
      calledNumbers.push(number);
      await this.sleep(delayMs);
    }

    return calledNumbers;
  }

  async navigateToGame(gameId?: string): Promise<void> {
    if (!this.page || !this.frontendUrl) {
      throw new Error('Browser not initialized');
    }

    const targetGameId = gameId || this.gameId;
    if (!targetGameId) throw new Error('No gameId provided');

    const url = `${this.frontendUrl}/organizer/game/${targetGameId}`;
    this.log(`Navigating to ${url}`);

    await this.page.goto(url, { waitUntil: 'networkidle' });
    await this.page.waitForSelector('text=Call Number', { timeout: 10000 });
    this.log('Organizer UI loaded');
  }

  async getPlayerCount(): Promise<number> {
    if (!this.page) throw new Error('Browser not initialized');

    // Count players in the players list
    const count = await this.page.locator('[data-player-item]').count();
    this.log(`Player count: ${count}`);
    return count;
  }

  async hardRefresh(): Promise<void> {
    if (!this.page) throw new Error('Browser not initialized');

    this.log('Hard refresh...');
    await this.page.reload({ waitUntil: 'networkidle' });
    await this.page.waitForSelector('text=Call Number', { timeout: 10000 });
    this.log('Hard refresh complete');
  }

  async deleteGame(gameId?: string): Promise<void> {
    const targetGameId = gameId || this.gameId;
    if (!targetGameId) throw new Error('No gameId provided');

    const API_URL = `${this.backendUrl}/api/v1`;

    const response = await fetch(`${API_URL}/games/${targetGameId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.account.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to delete game: ${response.status}`);
    }

    this.log(`Game deleted: ${targetGameId}`);
    this.gameId = null;
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.log('Socket disconnected');
    }
  }

  async closeBrowser(): Promise<void> {
    if (this.page) {
      await this.page.close();
      this.page = null;
      this.log('Browser closed');
    }
  }

  async cleanup(): Promise<void> {
    this.disconnect();
    await this.closeBrowser();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getSocket(): Socket | null {
    return this.socket;
  }

  getPage(): Page | null {
    return this.page;
  }
}
