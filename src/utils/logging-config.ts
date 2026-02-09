/**
 * Centralized Logging Configuration
 * Control what gets logged via environment variables
 */

export interface LoggingConfig {
  // Main categories
  organizerActions: boolean;
  playerActions: boolean;
  performance: boolean;
  websocket: boolean;
  database: boolean;
  errors: boolean;

  // Detailed subcategories
  playerJoin: boolean;
  playerLeave: boolean;
  numberMarking: boolean;
  winClaims: boolean;
  gameStateSync: boolean;

  // Performance tracking
  queryTiming: boolean;
  redisTiming: boolean;
  broadcastTiming: boolean;
}

// Parse boolean from env var (supports: true, false, 1, 0, yes, no)
function parseEnvBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  const lower = value.toLowerCase();
  return lower === 'true' || lower === '1' || lower === 'yes';
}

// Initialize logging config from environment variables
export const loggingConfig: LoggingConfig = {
  // Main categories (default: all enabled)
  organizerActions: parseEnvBoolean(process.env.LOG_ORGANIZER_ACTIONS, true),
  playerActions: parseEnvBoolean(process.env.LOG_PLAYER_ACTIONS, true),
  performance: parseEnvBoolean(process.env.LOG_PERFORMANCE, true),
  websocket: parseEnvBoolean(process.env.LOG_WEBSOCKET, true),
  database: parseEnvBoolean(process.env.LOG_DATABASE, false), // Disabled by default (too verbose)
  errors: parseEnvBoolean(process.env.LOG_ERRORS, true),

  // Detailed subcategories
  playerJoin: parseEnvBoolean(process.env.LOG_PLAYER_JOIN, true),
  playerLeave: parseEnvBoolean(process.env.LOG_PLAYER_LEAVE, true),
  numberMarking: parseEnvBoolean(process.env.LOG_NUMBER_MARKING, false), // Can be very verbose
  winClaims: parseEnvBoolean(process.env.LOG_WIN_CLAIMS, true),
  gameStateSync: parseEnvBoolean(process.env.LOG_GAME_STATE_SYNC, false), // Can be very verbose

  // Performance tracking
  queryTiming: parseEnvBoolean(process.env.LOG_QUERY_TIMING, true),
  redisTiming: parseEnvBoolean(process.env.LOG_REDIS_TIMING, true),
  broadcastTiming: parseEnvBoolean(process.env.LOG_BROADCAST_TIMING, true),
};

/**
 * Helper to check if a specific log category is enabled
 */
export function isLogEnabled(category: keyof LoggingConfig): boolean {
  return loggingConfig[category];
}

/**
 * Print current logging configuration on startup
 */
export function printLoggingConfig(): void {
  console.log('\n========== Logging Configuration ==========');
  console.log('Main Categories:');
  console.log(`  Organizer Actions: ${loggingConfig.organizerActions ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Player Actions:    ${loggingConfig.playerActions ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Performance:       ${loggingConfig.performance ? '✓ ON' : '✗ OFF'}`);
  console.log(`  WebSocket:         ${loggingConfig.websocket ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Database:          ${loggingConfig.database ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Errors:            ${loggingConfig.errors ? '✓ ON' : '✗ OFF'}`);
  console.log('\nDetailed Categories:');
  console.log(`  Player Join:       ${loggingConfig.playerJoin ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Player Leave:      ${loggingConfig.playerLeave ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Number Marking:    ${loggingConfig.numberMarking ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Win Claims:        ${loggingConfig.winClaims ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Game State Sync:   ${loggingConfig.gameStateSync ? '✓ ON' : '✗ OFF'}`);
  console.log('\nPerformance Tracking:');
  console.log(`  Query Timing:      ${loggingConfig.queryTiming ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Redis Timing:      ${loggingConfig.redisTiming ? '✓ ON' : '✗ OFF'}`);
  console.log(`  Broadcast Timing:  ${loggingConfig.broadcastTiming ? '✓ ON' : '✗ OFF'}`);
  console.log('===========================================\n');

  console.log('To change logging, set environment variables:');
  console.log('  LOG_ORGANIZER_ACTIONS=true/false');
  console.log('  LOG_PLAYER_ACTIONS=true/false');
  console.log('  LOG_PERFORMANCE=true/false');
  console.log('  LOG_NUMBER_MARKING=true/false (verbose)');
  console.log('  LOG_DATABASE=true/false (very verbose)');
  console.log('  etc.\n');
}
