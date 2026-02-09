/**
 * Validators Helper
 * Common validation and assertion functions for tests
 */

import { expect } from '@playwright/test';
import { SocketPlayer } from './socket-player';
import { BrowserPlayer } from './browser-player';

export class Validators {
  /**
   * Validate that all socket players received a specific event
   */
  static async validateEventBroadcast(
    players: SocketPlayer[],
    eventCheck: (player: SocketPlayer) => boolean,
    description: string
  ) {
    const failures: string[] = [];

    for (const player of players) {
      if (!eventCheck(player)) {
        failures.push(`${player.account.name} - ${description} failed`);
      }
    }

    if (failures.length > 0) {
      throw new Error(`Event broadcast validation failed:\n${failures.join('\n')}`);
    }
  }

  /**
   * Validate latency is within acceptable range
   */
  static validateLatency(latencyMs: number, maxLatencyMs: number, context: string) {
    if (latencyMs > maxLatencyMs) {
      throw new Error(`${context}: Latency ${latencyMs}ms exceeds max ${maxLatencyMs}ms`);
    }
  }

  /**
   * Validate no duplicate tickets across players
   */
  static validateUniqueTickets(players: SocketPlayer[]) {
    const tickets = players.map((p) => JSON.stringify(p.ticket));
    const uniqueTickets = new Set(tickets);

    if (tickets.length !== uniqueTickets.size) {
      throw new Error(`Duplicate tickets found! Expected ${tickets.length} unique tickets, got ${uniqueTickets.size}`);
    }
  }

  /**
   * Validate player state matches expected values
   */
  static validatePlayerState(
    player: SocketPlayer,
    expected: {
      markedCount?: number;
      calledCount?: number;
      winnersCount?: number;
    }
  ) {
    const errors: string[] = [];

    if (expected.markedCount !== undefined && player.markedNumbers.size !== expected.markedCount) {
      errors.push(`Marked numbers: expected ${expected.markedCount}, got ${player.markedNumbers.size}`);
    }

    if (expected.calledCount !== undefined && player.calledNumbers.length !== expected.calledCount) {
      errors.push(`Called numbers: expected ${expected.calledCount}, got ${player.calledNumbers.length}`);
    }

    if (expected.winnersCount !== undefined && player.winners.length !== expected.winnersCount) {
      errors.push(`Winners: expected ${expected.winnersCount}, got ${player.winners.length}`);
    }

    if (errors.length > 0) {
      throw new Error(`Player ${player.account.name} state validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Validate browser player UI state
   */
  static async validateBrowserState(
    player: BrowserPlayer,
    expected: {
      markedCount?: number;
      calledCount?: number;
      winnersCount?: number;
    }
  ) {
    const errors: string[] = [];

    if (expected.markedCount !== undefined) {
      const actual = await player.getMarkedNumbersCount();
      if (actual !== expected.markedCount) {
        errors.push(`Marked numbers: expected ${expected.markedCount}, got ${actual}`);
      }
    }

    if (expected.calledCount !== undefined) {
      const actual = await player.getCalledNumbersCount();
      if (actual !== expected.calledCount) {
        errors.push(`Called numbers: expected ${expected.calledCount}, got ${actual}`);
      }
    }

    if (expected.winnersCount !== undefined) {
      const actual = await player.getWinnersCount();
      if (actual !== expected.winnersCount) {
        errors.push(`Winners: expected ${expected.winnersCount}, got ${actual}`);
      }
    }

    if (errors.length > 0) {
      throw new Error(`Browser player ${player.account.name} UI validation failed:\n${errors.join('\n')}`);
    }
  }

  /**
   * Validate winner is in winners array
   */
  static validateWinner(
    players: SocketPlayer[],
    winnerPlayerId: string,
    category: string
  ) {
    const allWinners = players.flatMap((p) => p.winners);
    const winner = allWinners.find(
      (w) => w.playerId === winnerPlayerId && w.category === category
    );

    if (!winner) {
      throw new Error(
        `Winner validation failed: ${winnerPlayerId} not found in winners array for category ${category}`
      );
    }
  }

  /**
   * Validate only one winner for exclusive category (Early 5, Full House)
   */
  static validateExclusiveWinner(players: SocketPlayer[], category: string) {
    const allWinners = players.flatMap((p) => p.winners);
    const categoryWinners = allWinners.filter((w) => w.category === category);

    // Count unique winners by playerId (each player receives the same winner, so we need to deduplicate)
    const uniqueWinners = new Set(categoryWinners.map(w => w.playerId));

    if (uniqueWinners.size !== 1) {
      throw new Error(
        `Exclusive category ${category} should have exactly 1 winner, found ${uniqueWinners.size}`
      );
    }
  }

  /**
   * Validate all players have same called numbers
   */
  static validateConsistentCalledNumbers(players: SocketPlayer[]) {
    if (players.length === 0) return;

    const referenceCalledNumbers = JSON.stringify(players[0].calledNumbers);

    for (let i = 1; i < players.length; i++) {
      const playerCalledNumbers = JSON.stringify(players[i].calledNumbers);
      if (playerCalledNumbers !== referenceCalledNumbers) {
        throw new Error(
          `Called numbers inconsistency: ${players[i].account.name} has different called numbers than ${players[0].account.name}`
        );
      }
    }
  }

  /**
   * Validate ticket structure
   */
  static validateTicket(ticket: number[][] | null) {
    if (!ticket) {
      throw new Error('Ticket is null');
    }

    if (ticket.length !== 3) {
      throw new Error(`Ticket should have 3 rows, got ${ticket.length}`);
    }

    for (let row = 0; row < 3; row++) {
      if (ticket[row].length !== 9) {
        throw new Error(`Row ${row} should have 9 columns, got ${ticket[row].length}`);
      }

      const nonZeroCount = ticket[row].filter((n) => n !== 0).length;
      if (nonZeroCount !== 5) {
        throw new Error(`Row ${row} should have exactly 5 numbers, got ${nonZeroCount}`);
      }
    }

    // Count total numbers (should be 15)
    const totalNumbers = ticket.flat().filter((n) => n !== 0).length;
    if (totalNumbers !== 15) {
      throw new Error(`Ticket should have 15 numbers total, got ${totalNumbers}`);
    }
  }

  /**
   * Validate no errors occurred during test
   */
  static validateNoErrors(errorLog: Array<{ error: string; context?: any }>) {
    if (errorLog.length > 0) {
      const errorSummary = errorLog.map((e) => `  - ${e.error}`).join('\n');
      throw new Error(`Test recorded ${errorLog.length} errors:\n${errorSummary}`);
    }
  }

  /**
   * Wait for condition with timeout
   */
  static async waitForCondition(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number = 5000,
    checkIntervalMs: number = 100
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = await condition();
      if (result) return;

      await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
    }

    throw new Error(`Condition not met within ${timeoutMs}ms`);
  }

  /**
   * Retry operation with exponential backoff
   */
  static async retry<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    initialDelayMs: number = 1000
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;
        if (attempt < maxRetries - 1) {
          const delay = initialDelayMs * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError || new Error('Retry failed');
  }
}
