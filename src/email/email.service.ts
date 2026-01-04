import { Injectable, Logger } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly mailerService: MailerService) {}

  /**
   * Send OTP to email (used for register, login verify, forgot password)
   */
  async sendOtp(email: string, otp: string): Promise<void> {
    try {
      await this.mailerService.sendMail({
        to: email,
        subject: '33 Win - Your Verification Code',
        html: this.otpTemplate(otp),
      });
    } catch (error) {
      this.logger.error(`Failed to send OTP email to ${email}`, error);
      throw new Error('Failed to send OTP email');
    }
  }

  /**
   * OTP Email HTML Template
   */
  private otpTemplate(otp: string): string {
    return `
      <div style="font-family: Arial, sans-serif; background:#f9fafb; padding:30px;">
        <div style="max-width:480px; margin:auto; background:#ffffff; border-radius:8px; padding:24px;">
          <h2 style="color:#111827; text-align:center;">Verify your email</h2>

          <p style="color:#374151; font-size:14px;">
            Use the following One-Time Password (OTP) to continue.
          </p>

          <div style="text-align:center; margin:24px 0;">
            <span style="
              display:inline-block;
              font-size:32px;
              letter-spacing:6px;
              font-weight:bold;
              color:#D00000;
            ">
              ${otp}
            </span>
          </div>

          <p style="color:#6b7280; font-size:13px;">
            This OTP will expire in <strong>5 minutes</strong>.
            If you did not request this, please ignore this email.
          </p>

          <hr style="margin:24px 0; border:none; border-top:1px solid #e5e7eb;" />

          <p style="color:#9ca3af; font-size:12px; text-align:center;">
            © ${new Date().getFullYear()} 33 Win. All rights reserved.
          </p>
        </div>
      </div>
    `;
  }
}
