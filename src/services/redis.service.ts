import Redis from 'ioredis';

class RedisService {
  private client: Redis;
  private isConnected: boolean = false;

  constructor() {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          return true;
        }
        return false;
      },
    });

    this.client.on('connect', () => {
      console.log('✅ Redis connected successfully');
      this.isConnected = true;
    });

    this.client.on('error', (err) => {
      console.error('❌ Redis connection error:', err);
      this.isConnected = false;
    });

    this.client.on('close', () => {
      console.log('⚠️ Redis connection closed');
      this.isConnected = false;
    });
  }

  /**
   * Store OTP with expiration
   * @param otpId - Unique OTP identifier
   * @param otp - 6-digit OTP code
   * @param expiresInSeconds - Expiration time in seconds (default 300 = 5 minutes)
   */
  async storeOTP(otpId: string, otp: string, expiresInSeconds: number = 300): Promise<void> {
    const key = `otp:${otpId}`;
    await this.client.setex(key, expiresInSeconds, otp);
    console.log(`[Redis] OTP stored: ${key} (expires in ${expiresInSeconds}s)`);
  }

  /**
   * Get OTP by ID
   * @param otpId - Unique OTP identifier
   * @returns OTP code or null if expired/not found
   */
  async getOTP(otpId: string): Promise<string | null> {
    const key = `otp:${otpId}`;
    const otp = await this.client.get(key);
    console.log(`[Redis] OTP retrieved: ${key} = ${otp ? 'FOUND' : 'NOT_FOUND'}`);
    return otp;
  }

  /**
   * Delete OTP after verification
   * @param otpId - Unique OTP identifier
   */
  async deleteOTP(otpId: string): Promise<void> {
    const key = `otp:${otpId}`;
    await this.client.del(key);
    console.log(`[Redis] OTP deleted: ${key}`);
  }

  /**
   * Rate limiting: Track OTP requests per mobile number
   * @param mobileNumber - User's mobile number
   * @param maxAttempts - Maximum attempts allowed (default 3)
   * @param windowSeconds - Time window in seconds (default 3600 = 1 hour)
   * @returns Number of attempts remaining (0 if rate limited)
   */
  async checkRateLimit(
    mobileNumber: string,
    maxAttempts: number = 3,
    windowSeconds: number = 3600
  ): Promise<{ allowed: boolean; attemptsRemaining: number }> {
    const key = `ratelimit:otp:${mobileNumber}`;
    const current = await this.client.incr(key);

    if (current === 1) {
      // First request, set expiration
      await this.client.expire(key, windowSeconds);
    }

    const allowed = current <= maxAttempts;
    const attemptsRemaining = Math.max(0, maxAttempts - current);

    console.log(
      `[Redis] Rate limit check: ${key} = ${current}/${maxAttempts} (${allowed ? 'ALLOWED' : 'BLOCKED'})`
    );

    return { allowed, attemptsRemaining };
  }

  /**
   * Get Redis client instance (for Socket.IO adapter)
   */
  getClient(): Redis {
    return this.client;
  }

  /**
   * Check if Redis is connected
   */
  isReady(): boolean {
    return this.isConnected;
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.client.quit();
    console.log('Redis connection closed');
  }
}

// Export singleton instance
export const redisService = new RedisService();
