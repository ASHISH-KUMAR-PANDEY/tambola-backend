/**
 * Stage OTP Service
 * Uses Stage's backend API for OTP sending/verification
 * No MSG91 credentials needed - Stage handles SMS
 */

interface StageGetOTPRequest {
  mobileNumber: string;
  deviceId: string;
  lang: string;
  type: string;
}

interface StageGetOTPResponse {
  responseCode: number;
  data?: {
    id: string; // Used for OTP verification
    toastMessage?: string;
  };
  responseMessage?: string;
}

interface StageVerifyOTPRequest {
  id: string;
  mobileNumber: string;
  otp: string;
}

interface StageVerifyOTPResponse {
  responseCode: number;
  data?: {
    UserDetail: {
      _id: string;
      primaryMobileNumber: string;
      subscriptionStatus: number;
      primaryLanguage: string;
      [key: string]: any;
    };
    access: string; // Stage's access token (we won't use this)
  };
  responseMessage?: string;
}

class StageOTPService {
  private baseUrl: string;

  constructor() {
    // Use Stage's production API
    this.baseUrl = process.env.STAGE_API_BASE_URL || 'https://api.stage.in';
  }

  /**
   * Generate a device ID for Stage API
   * Stage requires this for tracking
   */
  private generateDeviceId(): string {
    return `tambola_web_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Send OTP via Stage's API
   * Stage handles SMS delivery using their MSG91 account
   */
  async sendOTP(mobileNumber: string): Promise<{ success: boolean; otpId: string; message?: string }> {
    try {
      const deviceId = this.generateDeviceId();

      const response = await fetch(`${this.baseUrl}/v20/user/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          mobileNumber,
          deviceId,
          lang: 'hin', // Hindi
          type: 'web',
        } as StageGetOTPRequest),
      });

      const data: StageGetOTPResponse = await response.json();

      if (data.responseCode === 200 && data.data?.id) {
        console.log(`[StageOTP] OTP sent successfully to ${mobileNumber} via Stage API`);
        return {
          success: true,
          otpId: data.data.id, // Stage's OTP session ID
        };
      } else {
        console.error('[StageOTP] Failed to send OTP:', data.responseMessage);
        return {
          success: false,
          otpId: '',
          message: data.data?.toastMessage || data.responseMessage || 'Failed to send OTP',
        };
      }
    } catch (error) {
      console.error('[StageOTP] Error sending OTP:', error);
      return {
        success: false,
        otpId: '',
        message: 'Network error while sending OTP',
      };
    }
  }

  /**
   * Verify OTP via Stage's API
   * Returns mobile number if OTP is valid (Stage validates it)
   */
  async verifyOTP(
    otpId: string,
    mobileNumber: string,
    otp: string
  ): Promise<{ success: boolean; mobileNumber?: string; message?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/v23/user/verifyOtp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          id: otpId,
          mobileNumber,
          otp,
        } as StageVerifyOTPRequest),
      });

      const data: StageVerifyOTPResponse = await response.json();

      if (data.responseCode === 200 && data.data?.UserDetail) {
        console.log(`[StageOTP] OTP verified successfully for ${mobileNumber} via Stage API`);
        return {
          success: true,
          mobileNumber: data.data.UserDetail.primaryMobileNumber,
        };
      } else {
        console.error('[StageOTP] Failed to verify OTP:', data.responseMessage);
        return {
          success: false,
          message: data.responseMessage || 'Invalid or expired OTP',
        };
      }
    } catch (error) {
      console.error('[StageOTP] Error verifying OTP:', error);
      return {
        success: false,
        message: 'Network error while verifying OTP',
      };
    }
  }

  /**
   * Check if Stage OTP service is configured
   */
  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }
}

// Export singleton instance
export const stageOTPService = new StageOTPService();
