import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  role: z.enum(['PLAYER', 'ORGANIZER']).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required'),
});

export const mobileVerifySchema = z.object({
  token: z.string().min(1, 'Token is required'),
});

export const sendOTPSchema = z.object({
  mobileNumber: z.string().regex(/^\d{10}$/, 'Mobile number must be exactly 10 digits'),
  countryCode: z.string().regex(/^\+\d{1,4}$/, 'Invalid country code').default('+91'),
});

export const verifyOTPSchema = z.object({
  mobileNumber: z.string().regex(/^\d{10}$/, 'Mobile number must be exactly 10 digits'),
  otp: z.string().regex(/^\d{6}$/, 'OTP must be exactly 6 digits'),
  otpId: z.string().min(1, 'OTP ID is required'),
});

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type MobileVerifyInput = z.infer<typeof mobileVerifySchema>;
export type SendOTPInput = z.infer<typeof sendOTPSchema>;
export type VerifyOTPInput = z.infer<typeof verifyOTPSchema>;
