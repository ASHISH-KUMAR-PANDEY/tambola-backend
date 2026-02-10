/**
 * SMS Service for sending OTP via MSG91
 * MSG91 is a popular SMS provider in India with competitive pricing
 */

interface SendOTPParams {
  mobileNumber: string;
  countryCode: string;
  otp: string;
}

interface MSG91Response {
  type: string;
  message: string;
}

class SMSService {
  private authKey: string;
  private templateId: string;
  private senderId: string;
  private isProduction: boolean;

  constructor() {
    this.authKey = process.env.MSG91_AUTH_KEY || '';
    this.templateId = process.env.MSG91_TEMPLATE_ID || '';
    this.senderId = process.env.MSG91_SENDER_ID || 'TAMBLA';
    this.isProduction = process.env.NODE_ENV === 'production';

    if (!this.authKey && this.isProduction) {
      console.warn('⚠️ MSG91_AUTH_KEY not configured. SMS will not be sent in production.');
    }
  }

  /**
   * Generate a 6-digit OTP
   */
  generateOTP(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Send OTP via MSG91
   */
  async sendOTP({ mobileNumber, countryCode, otp }: SendOTPParams): Promise<boolean> {
    // In development, just log the OTP
    if (!this.isProduction || !this.authKey) {
      console.log(`\n🔐 [DEV MODE] OTP for ${countryCode}${mobileNumber}: ${otp}\n`);
      return true;
    }

    try {
      const fullNumber = `${countryCode}${mobileNumber}`;

      // MSG91 OTP API v5
      const response = await fetch('https://control.msg91.com/api/v5/otp', {
        method: 'POST',
        headers: {
          'authkey': this.authKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          template_id: this.templateId,
          mobile: fullNumber,
          otp: otp,
          sender: this.senderId,
          // Optional: Add dynamic variables if your template has them
          // For example: "Your Tambola OTP is ##OTP##. Valid for 5 minutes."
        }),
      });

      const data: MSG91Response = await response.json();

      if (response.ok && data.type === 'success') {
        console.log(`✅ OTP sent successfully to ${fullNumber}`);
        return true;
      } else {
        console.error(`❌ Failed to send OTP to ${fullNumber}:`, data.message);
        return false;
      }
    } catch (error) {
      console.error('❌ SMS Service Error:', error);
      return false;
    }
  }

  /**
   * Alternative: Send OTP using MSG91's simpler text SMS API
   * Use this if you don't have a DLT-approved template yet
   */
  async sendOTPViaTextSMS({ mobileNumber, countryCode, otp }: SendOTPParams): Promise<boolean> {
    // In development, just log the OTP
    if (!this.isProduction || !this.authKey) {
      console.log(`\n🔐 [DEV MODE] OTP for ${countryCode}${mobileNumber}: ${otp}\n`);
      return true;
    }

    try {
      const fullNumber = `${countryCode}${mobileNumber}`;
      const message = `Your Tambola OTP is ${otp}. Valid for 5 minutes. Do not share with anyone.`;

      // MSG91 Text SMS API
      const response = await fetch('https://control.msg91.com/api/sendhttp.php', {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          authkey: this.authKey,
          mobiles: fullNumber,
          message: message,
          sender: this.senderId,
          route: '4', // Route 4 = Transactional SMS
        }),
      });

      const responseText = await response.text();

      if (response.ok && !responseText.includes('Error')) {
        console.log(`✅ OTP sent successfully to ${fullNumber}`);
        return true;
      } else {
        console.error(`❌ Failed to send OTP to ${fullNumber}:`, responseText);
        return false;
      }
    } catch (error) {
      console.error('❌ SMS Service Error:', error);
      return false;
    }
  }

  /**
   * Check if SMS service is configured
   */
  isConfigured(): boolean {
    return Boolean(this.authKey);
  }
}

// Export singleton instance
export const smsService = new SMSService();
