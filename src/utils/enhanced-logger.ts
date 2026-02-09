/**
 * Enhanced Logger with Category-Based Control
 * Wraps pino logger with configurable categories
 */

import { logger } from './logger.js';
import { isLogEnabled } from './logging-config.js';

interface BaseLogData {
  timestamp?: string;
  [key: string]: any;
}

interface PerformanceMetrics {
  duration_ms: number;
  operationType?: string;
}

/**
 * Enhanced logger with category controls
 */
export const enhancedLogger = {
  // ========== ORGANIZER ACTIONS ==========

  organizerAction(action: string, data: BaseLogData, message: string) {
    if (!isLogEnabled('organizerActions')) return;

    logger.info({
      event: 'ORGANIZER_ACTION',
      action,
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  // ========== PLAYER ACTIONS ==========

  playerAction(action: string, data: BaseLogData, message: string) {
    if (!isLogEnabled('playerActions')) return;

    logger.info({
      event: 'PLAYER_ACTION',
      action,
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  playerJoin(data: BaseLogData, message: string) {
    if (!isLogEnabled('playerJoin')) return;

    logger.info({
      event: 'PLAYER_ACTION',
      action: 'PLAYER_JOIN',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  playerLeave(data: BaseLogData, message: string) {
    if (!isLogEnabled('playerLeave')) return;

    logger.info({
      event: 'PLAYER_ACTION',
      action: 'PLAYER_LEAVE',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  playerMarkNumber(data: BaseLogData, message: string) {
    if (!isLogEnabled('numberMarking')) return;

    logger.info({
      event: 'PLAYER_ACTION',
      action: 'MARK_NUMBER',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  playerWinClaim(data: BaseLogData, message: string) {
    if (!isLogEnabled('winClaims')) return;

    logger.info({
      event: 'PLAYER_ACTION',
      action: 'WIN_CLAIM',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  gameStateSync(data: BaseLogData, message: string) {
    if (!isLogEnabled('gameStateSync')) return;

    logger.info({
      event: 'PLAYER_ACTION',
      action: 'STATE_SYNC',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  // ========== PERFORMANCE ==========

  performance(operation: string, metrics: PerformanceMetrics, data: BaseLogData, message: string) {
    if (!isLogEnabled('performance')) return;

    logger.info({
      event: 'PERFORMANCE',
      operation,
      ...metrics,
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  queryTiming(queryName: string, duration_ms: number, data: BaseLogData) {
    if (!isLogEnabled('queryTiming')) return;

    logger.info({
      event: 'PERFORMANCE',
      operation: 'DB_QUERY',
      queryName,
      duration_ms,
      timestamp: new Date().toISOString(),
      ...data,
    }, `Query ${queryName} completed in ${duration_ms}ms`);
  },

  redisTiming(operation: string, duration_ms: number, data: BaseLogData) {
    if (!isLogEnabled('redisTiming')) return;

    logger.info({
      event: 'PERFORMANCE',
      operation: 'REDIS',
      redisOperation: operation,
      duration_ms,
      timestamp: new Date().toISOString(),
      ...data,
    }, `Redis ${operation} completed in ${duration_ms}ms`);
  },

  broadcastTiming(eventName: string, duration_ms: number, recipientCount: number, data: BaseLogData) {
    if (!isLogEnabled('broadcastTiming')) return;

    logger.info({
      event: 'PERFORMANCE',
      operation: 'BROADCAST',
      eventName,
      duration_ms,
      recipientCount,
      timestamp: new Date().toISOString(),
      ...data,
    }, `Broadcast ${eventName} to ${recipientCount} recipients in ${duration_ms}ms`);
  },

  // ========== WEBSOCKET ==========

  websocketConnect(data: BaseLogData, message: string) {
    if (!isLogEnabled('websocket')) return;

    logger.info({
      event: 'WEBSOCKET',
      action: 'CONNECT',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  websocketDisconnect(data: BaseLogData, message: string) {
    if (!isLogEnabled('websocket')) return;

    logger.info({
      event: 'WEBSOCKET',
      action: 'DISCONNECT',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  websocketError(data: BaseLogData, message: string) {
    if (!isLogEnabled('websocket')) return;

    logger.error({
      event: 'WEBSOCKET',
      action: 'ERROR',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  // ========== DATABASE ==========

  databaseQuery(queryType: string, data: BaseLogData, message: string) {
    if (!isLogEnabled('database')) return;

    logger.info({
      event: 'DATABASE',
      queryType,
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  // ========== ERRORS ==========

  error(category: string, error: Error | unknown, data: BaseLogData, message: string) {
    if (!isLogEnabled('errors')) return;

    logger.error({
      event: 'ERROR',
      category,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },

  // ========== GENERIC INFO/WARN/ERROR (always logged) ==========

  info(data: BaseLogData, message: string) {
    logger.info(data, message);
  },

  warn(data: BaseLogData, message: string) {
    logger.warn(data, message);
  },

  criticalError(data: BaseLogData, message: string) {
    // Critical errors are always logged regardless of config
    logger.error({
      severity: 'CRITICAL',
      timestamp: new Date().toISOString(),
      ...data,
    }, message);
  },
};

/**
 * Performance tracker helper
 */
export class PerformanceTracker {
  private startTime: number;
  private label: string;
  private metadata: BaseLogData;

  constructor(label: string, metadata: BaseLogData = {}) {
    this.startTime = Date.now();
    this.label = label;
    this.metadata = metadata;
  }

  end(additionalData: BaseLogData = {}) {
    const duration = Date.now() - this.startTime;
    enhancedLogger.performance(
      this.label,
      { duration_ms: duration },
      { ...this.metadata, ...additionalData },
      `${this.label} completed in ${duration}ms`
    );
    return duration;
  }

  getDuration(): number {
    return Date.now() - this.startTime;
  }
}
