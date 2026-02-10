import type { FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import { prisma } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import { loginSchema, signupSchema, mobileVerifySchema, sendOTPSchema, verifyOTPSchema, type LoginInput, type SignupInput, type MobileVerifyInput, type SendOTPInput, type VerifyOTPInput } from './auth.schema.js';
import { redisService } from '../../services/redis.service.js';
import { smsService } from '../../services/sms.service.js';

const SALT_ROUNDS = 10;

export async function signup(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Validate request body
    const body = signupSchema.parse(request.body);

    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (existingUser) {
      throw new AppError('USER_EXISTS', 'User with this email already exists', 409);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(body.password, SALT_ROUNDS);

    // Create user
    const user = await prisma.user.create({
      data: {
        email: body.email,
        password: hashedPassword,
        name: body.name,
        role: body.role || 'PLAYER',
      },
    });

    // Generate JWT token
    const token = request.server.jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    await reply.status(201).send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('Signup error:', error);
    throw new AppError('SIGNUP_FAILED', 'Failed to create user account', 500);
  }
}

export async function login(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Validate request body
    const body = loginSchema.parse(request.body);

    // Find user
    const user = await prisma.user.findUnique({
      where: { email: body.email },
    });

    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(body.password, user.password);

    if (!isPasswordValid) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    // Generate JWT token
    const token = request.server.jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    await reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('LOGIN_FAILED', 'Failed to log in', 500);
  }
}

export async function me(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const decoded = (await request.jwtVerify()) as any;

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    await reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('UNAUTHORIZED', 'Invalid authentication token', 401);
  }
}

export async function validateUser(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const { userId } = request.body as { userId: string };

    if (!userId) {
      throw new AppError('INVALID_REQUEST', 'userId is required', 400);
    }

    // Find user by ID
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    // Generate JWT token
    const token = request.server.jwt.sign({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    await reply.send({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
      },
      token,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError('VALIDATION_FAILED', 'Failed to validate user', 500);
  }
}

/**
 * Verify mobile app token and return userId
 * Used by Flutter WebView bridge for authentication
 */
export async function mobileVerify(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Validate request body
    const body = mobileVerifySchema.parse(request.body);

    console.log('[mobileVerify] Received token verification request');

    // Verify JWT token
    let decoded: any;
    try {
      decoded = request.server.jwt.verify(body.token);
      console.log('[mobileVerify] Token verified successfully, userId:', decoded.userId);
    } catch (error) {
      console.error('[mobileVerify] Token verification failed:', error);
      throw new AppError('INVALID_TOKEN', 'Invalid or expired token', 401);
    }

    // Extract userId from token payload
    const userId = decoded.userId || decoded.id || decoded.sub;

    if (!userId) {
      console.error('[mobileVerify] No userId found in token payload');
      throw new AppError('INVALID_TOKEN', 'Token does not contain userId', 401);
    }

    // Optionally verify user exists in database (add extra security)
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, role: true },
    });

    if (!user) {
      console.warn('[mobileVerify] User not found for userId:', userId);
      // Don't fail - mobile app users might not exist in User table
      // They will be created when needed or use the app_user_id flow
    }

    console.log('[mobileVerify] Verification successful, returning userId:', userId);

    await reply.send({
      valid: true,
      userId,
      user: user ? {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      } : null,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('[mobileVerify] Verification error:', error);
    throw new AppError('VERIFICATION_FAILED', 'Failed to verify mobile token', 500);
  }
}

/**
 * Send OTP to mobile number
 * Rate limited to 3 attempts per hour
 */
export async function sendOTP(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Validate request body
    const body = sendOTPSchema.parse(request.body);

    console.log(`[sendOTP] Request for mobile: ${body.countryCode}${body.mobileNumber}`);

    // Check rate limiting
    const rateLimit = await redisService.checkRateLimit(
      body.mobileNumber,
      3, // Max 3 attempts
      3600 // Per hour
    );

    if (!rateLimit.allowed) {
      console.warn(`[sendOTP] Rate limit exceeded for: ${body.mobileNumber}`);
      throw new AppError(
        'RATE_LIMIT_EXCEEDED',
        'Too many OTP requests. Please try again in 1 hour.',
        429
      );
    }

    // Generate OTP and OTP ID
    const otp = smsService.generateOTP();
    const otpId = `otp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresIn = 300; // 5 minutes

    // Store OTP in Redis
    await redisService.storeOTP(otpId, otp, expiresIn);

    // Send OTP via SMS
    const smsSent = await smsService.sendOTP({
      mobileNumber: body.mobileNumber,
      countryCode: body.countryCode,
      otp,
    });

    if (!smsSent) {
      throw new AppError('SMS_FAILED', 'Failed to send OTP. Please try again.', 500);
    }

    console.log(`[sendOTP] OTP sent successfully to: ${body.mobileNumber}`);

    await reply.send({
      success: true,
      message: 'OTP sent successfully',
      otpId,
      expiresIn,
      attemptsRemaining: rateLimit.attemptsRemaining - 1,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('[sendOTP] Error:', error);
    throw new AppError('SEND_OTP_FAILED', 'Failed to send OTP', 500);
  }
}

/**
 * Verify OTP and login/signup user
 * Auto-creates user if mobile number doesn't exist
 */
export async function verifyOTP(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Validate request body
    const body = verifyOTPSchema.parse(request.body);

    console.log(`[verifyOTP] Verification request for: ${body.mobileNumber}`);

    // Get OTP from Redis
    const storedOTP = await redisService.getOTP(body.otpId);

    if (!storedOTP) {
      console.warn(`[verifyOTP] OTP not found or expired for: ${body.otpId}`);
      throw new AppError('INVALID_OTP', 'Invalid or expired OTP', 400);
    }

    // Verify OTP
    if (storedOTP !== body.otp) {
      console.warn(`[verifyOTP] OTP mismatch for: ${body.mobileNumber}`);
      throw new AppError('INVALID_OTP', 'Invalid OTP', 400);
    }

    // Delete OTP after successful verification
    await redisService.deleteOTP(body.otpId);

    // Find or create user
    let user = await prisma.user.findUnique({
      where: { mobileNumber: body.mobileNumber },
    });

    const isNewUser = !user;

    if (!user) {
      console.log(`[verifyOTP] Creating new user for: ${body.mobileNumber}`);

      // Auto-create user with mobile number
      user = await prisma.user.create({
        data: {
          mobileNumber: body.mobileNumber,
          countryCode: '+91',
          email: null, // No email for OTP-only users
          password: null, // No password for OTP-only users
          name: null, // Will be set later in lobby
          role: 'PLAYER',
        },
      });

      console.log(`[verifyOTP] New user created with ID: ${user.id}`);
    } else {
      console.log(`[verifyOTP] Existing user found with ID: ${user.id}`);
    }

    // Generate JWT token
    const token = request.server.jwt.sign({
      userId: user.id,
      mobileNumber: user.mobileNumber,
      role: user.role,
    });

    console.log(`[verifyOTP] Login successful for: ${body.mobileNumber}`);

    await reply.send({
      success: true,
      isNewUser,
      userId: user.id,
      userName: user.name,
      mobileNumber: user.mobileNumber,
      accessToken: token,
    });
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('[verifyOTP] Error:', error);
    throw new AppError('VERIFY_OTP_FAILED', 'Failed to verify OTP', 500);
  }
}
