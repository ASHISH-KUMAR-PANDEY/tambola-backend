/**
 * Socket Player Helper
 * Lightweight Socket.IO client for testing player actions
 * Used for performance testing and event monitoring
 *
 * UPDATED: Supports current lobby flow (lobby:join → game:start → game:join)
 */

import { io, Socket } from 'socket.io-client';

export interface PlayerAccount {
  id: string;
  name: string;
  email: string;
  password: string;
  token: string;
}

export interface SocketPlayerOptions {
  account: PlayerAccount;
  backendUrl: string;
  debug?: boolean;
}

export class SocketPlayer {
  private socket: Socket | null = null;
  private account: PlayerAccount;
  private backendUrl: string;
  private debug: boolean;

  public gameId: string | null = null;
  public playerId: string | null = null;
  public ticket: number[][] | null = null;
  public markedNumbers: Set<number> = new Set();
  public calledNumbers: number[] = [];
  public currentNumber: number | null = null;
  public winners: any[] = [];
  public inLobby: boolean = false;

  // Event timing metrics
  public metrics = {
    connectTime: 0,
    lobbyJoinTime: 0,
    gameJoinTime: 0,
    lastEventLatency: 0,
    eventCount: 0,
  };

  constructor(options: SocketPlayerOptions) {
    this.account = options.account;
    this.backendUrl = options.backendUrl;
    this.debug = options.debug || false;
  }

  private log(message: string, data?: any) {
    if (this.debug) {
      console.log(`[SocketPlayer:${this.account.name}] ${message}`, data || '');
    }
  }

  async connect(): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      this.socket = io(this.backendUrl, {
        auth: { userId: this.account.id },
        transports: ['websocket'], // Use WebSocket for production
      });

      this.socket.on('connect', () => {
        this.metrics.connectTime = Date.now() - startTime;
        this.log(`Connected (${this.metrics.connectTime}ms)`);
        this.setupListeners();
        resolve();
      });

      this.socket.on('connect_error', (error) => {
        this.log('Connection error', error);
        reject(error);
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.socket?.connected) {
          reject(new Error('Connection timeout'));
        }
      }, 10000);
    });
  }

  private setupListeners() {
    if (!this.socket) return;

    // Lobby events
    this.socket.on('lobby:playerJoined', (data) => {
      this.log(`Lobby updated: ${data.playerCount} players`);
    });

    // Game events
    this.socket.on('game:starting', (data) => {
      this.log('Game is starting!');
      this.inLobby = false;
    });

    this.socket.on('game:numberCalled', (data) => {
      this.metrics.eventCount++;
      this.metrics.lastEventLatency = Date.now() - (data.timestamp || Date.now());
      this.calledNumbers.push(data.number);
      this.currentNumber = data.number;
      this.log(`Number called: ${data.number}`);
    });

    this.socket.on('game:winner', (data) => {
      this.metrics.eventCount++;
      this.winners.push(data);
      this.log(`Winner announced: ${data.category}`);
    });

    this.socket.on('game:stateSync', (data) => {
      this.calledNumbers = data.calledNumbers || [];
      this.currentNumber = data.currentNumber || null;

      // Merge winners instead of replacing
      if (data.winners && data.winners.length > 0) {
        const existingWinnerIds = new Set(this.winners.map(w => `${w.playerId}-${w.category}`));
        const newWinners = data.winners.filter((w: any) => !existingWinnerIds.has(`${w.playerId}-${w.category}`));
        this.winners.push(...newWinners);
      }

      if (data.markedNumbers) {
        this.markedNumbers = new Set(data.markedNumbers);
      }
      this.log(`State synced: ${this.calledNumbers.length} called, ${this.winners.length} winners`);
    });

    this.socket.on('game:started', (data) => {
      this.log('Game started');
    });

    this.socket.on('game:ended', (data) => {
      this.log('Game ended');
    });

    this.socket.on('error', (error) => {
      this.log('Socket error', error);
    });
  }

  /**
   * Join waiting lobby (before game starts)
   * NEW: Current production flow step 1
   */
  async joinLobby(gameId: string): Promise<void> {
    if (!this.socket) throw new Error('Socket not connected');

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      this.socket!.emit('lobby:join', {
        gameId,
        userName: this.account.name,
      });

      this.socket!.once('lobby:joined', (data) => {
        this.metrics.lobbyJoinTime = Date.now() - startTime;
        this.gameId = gameId;
        this.inLobby = true;
        this.log(`Joined lobby (${this.metrics.lobbyJoinTime}ms)`, { playerCount: data.playerCount });
        resolve();
      });

      this.socket!.once('error', (error) => {
        this.log('Lobby join error', error);
        reject(new Error(error.message || 'Failed to join lobby'));
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.inLobby) {
          reject(new Error('Lobby join timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Join active game (after game starts)
   * Called after receiving "game:starting" event
   */
  async joinGame(gameId: string): Promise<void> {
    if (!this.socket) throw new Error('Socket not connected');

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      this.socket!.emit('game:join', { gameId });

      this.socket!.once('game:joined', (data) => {
        this.metrics.gameJoinTime = Date.now() - startTime;
        this.gameId = gameId;
        this.playerId = data.playerId;
        this.ticket = data.ticket;
        this.log(`Joined game (${this.metrics.gameJoinTime}ms)`, { playerId: this.playerId });
        resolve();
      });

      this.socket!.once('error', (error) => {
        this.log('Game join error', error);
        reject(new Error(error.message || 'Failed to join game'));
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.playerId) {
          reject(new Error('Game join timeout'));
        }
      }, 10000);
    });
  }

  /**
   * Wait for game to start (after joining lobby)
   * Listens for "game:starting" event
   */
  async waitForGameStart(): Promise<void> {
    if (!this.socket) throw new Error('Socket not connected');

    return new Promise((resolve, reject) => {
      this.socket!.once('game:starting', (data) => {
        this.log('Received game:starting event');
        resolve();
      });

      // Timeout after 60 seconds
      setTimeout(() => {
        reject(new Error('Game start timeout'));
      }, 60000);
    });
  }

  /**
   * Full flow: Join lobby → Wait for start → Join game
   * Convenience method for complete player flow
   */
  async joinLobbyAndWaitForStart(gameId: string): Promise<void> {
    await this.joinLobby(gameId);
    await this.waitForGameStart();
    await this.joinGame(gameId);
  }

  markNumber(number: number) {
    if (!this.socket || !this.gameId || !this.playerId) {
      throw new Error('Not in a game');
    }

    if (!this.calledNumbers.includes(number)) {
      throw new Error('Number not called');
    }

    this.socket.emit('game:markNumber', {
      gameId: this.gameId,
      playerId: this.playerId,
      number,
    });

    this.markedNumbers.add(number);
    this.log(`Marked number: ${number}`);
  }

  async claimWin(category: string): Promise<{ success: boolean; message: string }> {
    if (!this.socket || !this.gameId) {
      throw new Error('Not in a game');
    }

    return new Promise((resolve) => {
      this.socket!.emit('game:claimWin', {
        gameId: this.gameId,
        category,
      });

      this.socket!.once('game:winClaimed', (data) => {
        this.log(`Win claim result: ${data.message}`);

        // If win claim successful, add ourselves to winners array
        if (data.success && this.playerId) {
          this.winners.push({
            playerId: this.playerId,
            category: category,
            userName: this.account.name,
          });
        }

        resolve({ success: data.success, message: data.message });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        resolve({ success: false, message: 'Claim timeout' });
      }, 5000);
    });
  }

  leaveLobby() {
    if (!this.socket || !this.gameId) return;

    this.socket.emit('lobby:leave', { gameId: this.gameId });
    this.log('Left lobby');

    this.inLobby = false;
    this.gameId = null;
  }

  leaveGame() {
    if (!this.socket || !this.gameId) return;

    this.socket.emit('game:leave', { gameId: this.gameId });
    this.log('Left game');

    // Clear state
    this.gameId = null;
    this.playerId = null;
    this.ticket = null;
    this.markedNumbers.clear();
    this.calledNumbers = [];
    this.currentNumber = null;
    this.winners = [];
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.log('Disconnected');
    }
  }

  reconnect(): Promise<void> {
    if (this.socket) {
      this.socket.connect();
    }
    return this.connect();
  }

  isConnected(): boolean {
    return this.socket?.connected || false;
  }

  getMetrics() {
    return { ...this.metrics };
  }

  // Helper: Auto-mark numbers as they're called
  enableAutoMark() {
    if (!this.socket) return;

    this.socket.on('game:numberCalled', (data) => {
      const number = data.number;

      // Check if number is on ticket
      if (this.ticket) {
        for (let row = 0; row < 3; row++) {
          for (let col = 0; col < 9; col++) {
            if (this.ticket[row][col] === number) {
              // Mark after small random delay (simulate human reaction)
              const delay = Math.random() * 2000 + 500; // 500-2500ms
              setTimeout(() => {
                try {
                  this.markNumber(number);
                } catch (e) {
                  // Ignore marking errors
                }
              }, delay);
              return;
            }
          }
        }
      }
    });
  }
}
