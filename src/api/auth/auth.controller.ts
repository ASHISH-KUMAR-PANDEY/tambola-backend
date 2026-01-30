import type { FastifyReply, FastifyRequest } from 'fastify';
import bcrypt from 'bcrypt';
import { User } from '../../models/index.js';
import { AppError } from '../../utils/error.js';
import { loginSchema, signupSchema, type LoginInput, type SignupInput } from './auth.schema.js';

const SALT_ROUNDS = 10;

export async function signup(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    // Validate request body
    const body = signupSchema.parse(request.body);

    // Check if user already exists
    const existingUser = await User.findOne({ email: body.email });

    if (existingUser) {
      throw new AppError('USER_EXISTS', 'User with this email already exists', 409);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(body.password, SALT_ROUNDS);

    // Create user
    const user = await User.create({
      email: body.email,
      password: hashedPassword,
      name: body.name,
      role: body.role || 'PLAYER',
    });

    // Generate JWT token
    const token = request.server.jwt.sign({
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    await reply.status(201).send({
      user: {
        id: user._id.toString(),
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
    const user = await User.findOne({ email: body.email });

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
      userId: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    await reply.send({
      user: {
        id: user._id.toString(),
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

    const user = await User.findById(decoded.userId).select('email name role createdAt');

    if (!user) {
      throw new AppError('USER_NOT_FOUND', 'User not found', 404);
    }

    await reply.send({
      user: {
        id: user._id.toString(),
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
