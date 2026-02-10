import type { FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import { prisma } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import { loginSchema, signupSchema, mobileVerifySchema, type LoginInput, type SignupInput, type MobileVerifyInput } from './auth.schema.js';

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

    // Check if user has password (OTP users don't have passwords)
    if (!user.password) {
      throw new AppError('INVALID_CREDENTIALS', 'This account uses OTP login. Please use mobile number login.', 401);
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
 * NOTE: OTP endpoints removed - Frontend calls Stage API directly
 *
 * Flow:
 * 1. Frontend → Stage API: Send OTP
 * 2. Frontend → Stage API: Verify OTP → Get Stage userId
 * 3. Frontend → Tambola backend: validateUser(userId) → Get Tambola user
 * 4. Frontend → Tambola WebSocket: Connect with userId
 */
