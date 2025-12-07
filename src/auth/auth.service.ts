import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { Gender, Role } from '@prisma/client';
import { hashPassword, comparePassword } from 'src/utils/password.util';
import { generateOtp } from 'src/utils/otp.util';
import { JwtService } from '@nestjs/jwt';
import { ApproveAgentDto } from './dto/approve-agent.dto';
import { v4 as uuidv4 } from 'uuid';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyForgotOtpDto,
} from './dto/forgot-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // inside AuthService class

  // create access token (unchanged)
  private async createAccessToken(userId: string, role: string) {
    return this.jwtService.signAsync(
      { sub: userId, role },
      { expiresIn: '15m' },
    );
  }

  // create refresh token with explicit jti so we can persist metadata easily
  private async createRefreshToken(userId: string, jti?: string) {
    const tokenJti = jti ?? uuidv4();
    const token = await this.jwtService.signAsync(
      { sub: userId, jti: tokenJti },
      { expiresIn: '7d' },
    );
    return { token, jti: tokenJti };
  }

  /**
   * Generate token pair and persist refresh token as new row (do NOT delete existing).
   * Accepts optional device metadata so each device gets its own refresh row.
   */
  async generateTokenPair(
    userId: string,
    role: string,
    meta?: { deviceId?: string; ip?: string; userAgent?: string },
  ) {
    const accessToken = await this.createAccessToken(userId, role);
    const { token: refreshToken, jti } = await this.createRefreshToken(userId);

    // -----------------------------
    // One active session per deviceId
    // -----------------------------
    if (meta?.deviceId) {
      await this.prisma.refreshToken.deleteMany({
        where: {
          userId,
          deviceId: meta.deviceId,
        },
      });
    }

    // Create fresh token entry
    await this.prisma.refreshToken.create({
      data: {
        userId,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        deviceId: meta?.deviceId,
        ip: meta?.ip,
        userAgent: meta?.userAgent,
      },
    });

    return { accessToken, refreshToken };
  }

  async getUserFromAccessToken(accessToken: string) {
    if (!accessToken) throw new UnauthorizedException('No access token');

    let payload: any;
    try {
      // Verifies signature and expiry. Throws on invalid/expired token.
      payload = await this.jwtService.verifyAsync(accessToken);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired access token');
    }

    const userId = payload.sub;
    if (!userId) throw new UnauthorizedException('Invalid token payload');

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        email: true,
        role: true,
        isApproved: true,
        isPhoneVerified: true,
      },
    });

    if (!user) throw new UnauthorizedException('User not found');

    // Return a minimal "safe" user object (no secrets/tokens)
    return {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      email: user.email,
      role: user.role,
      isApproved: user.isApproved,
      isPhoneVerified: user.isPhoneVerified,
    };
  }

  /**
   * Refresh flow: look up the exact token row, validate expiry, rotate only that row.
   * tokenStr - the refresh token presented by client
   * meta - optional device metadata to update the new row
   */
  async refresh(
    tokenStr: string,
    meta?: { deviceId?: string; ip?: string; userAgent?: string },
  ) {
    if (!tokenStr) {
      throw new UnauthorizedException('Missing refresh token');
    }

    // find the stored token record by token value (token is unique)
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: tokenStr },
    });

    if (!stored) {
      // token not found -> possible reuse or invalid token
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt && stored.expiresAt < new Date()) {
      // expired: remove and reject
      await this.prisma.refreshToken.deleteMany({
        where: { token: tokenStr },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    // verify the JWT is valid semantically (signature, expiry)
    try {
      await this.jwtService.verifyAsync(tokenStr);
    } catch (e) {
      // invalid token: delete stored row to be safe
      await this.prisma.refreshToken
        .deleteMany({ where: { token: tokenStr } })
        .catch(() => {});
      throw new UnauthorizedException('Invalid refresh token');
    }

    // rotate: delete the old row and create a new row for the same device
    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
    });

    // create new access token (uses your createAccessToken - 15m)
    const newAccessToken = await this.createAccessToken(
      stored.userId,
      user?.role || Role.AGENT,
    );

    // create new refresh token
    const { token: newRefreshToken } = await this.createRefreshToken(
      stored.userId,
    );

    // transaction: remove old row and insert new row
    await this.prisma.$transaction([
      this.prisma.refreshToken.delete({ where: { id: stored.id } }),
      this.prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          token: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          deviceId: meta?.deviceId ?? stored.deviceId,
          ip: meta?.ip ?? stored.ip,
          userAgent: meta?.userAgent ?? stored.userAgent,
        },
      }),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  /**
   * logout: delete only the provided refresh token row (per-device).
   * if no refreshToken provided but userId present, delete all tokens for that user (logout all devices).
   */
  async logout(refreshToken: string | null, userId?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
      return { message: 'Logged out from device' };
    } else if (userId) {
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
      return { message: 'Logged out from all devices' };
    }

    return { message: 'Nothing to logout' };
  }

  async register(dto: RegisterDto) {
    const exists = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (exists) throw new BadRequestException('Phone already registered');

    const emailExists = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (emailExists) throw new BadRequestException('Email already registered');

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    const passwordHash = await hashPassword(dto.password);

    const settings = await this.prisma.appSettings.findFirst();

    if (!settings) {
      throw new BadRequestException('AppSettings not configured by admin');
    }

    const commissionPct = settings.defaultCommissionPct ?? 0;

    const user = await this.prisma.user.create({
      data: {
        role: Role.AGENT,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone,
        email: dto.email,
        gender: (dto.gender as Gender) ?? null,

        dob: dto.dob ? new Date(dto.dob) : null,
        passwordHash,
        otpCode: otp,
        otpExpiry,
        isApproved: false,
        isPhoneVerified: false,

        // ⭐ Set commission from settings
        commissionPct,
      },
    });

    // Ensure wallets are created if missing
    await this.prisma.wallet.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    // TODO: send SMS OTP

    return { message: 'OTP sent', userId: user.id };
  }

  async verifyOtp(dto: VerifyOtpDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });

    if (!user) throw new BadRequestException('Invalid user');

    if (user.otpCode !== dto.otp)
      throw new BadRequestException('Incorrect OTP');
    if (!user.otpExpiry || user.otpExpiry < new Date()) {
      throw new BadRequestException('OTP expired');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        isPhoneVerified: true,
        otpCode: null,
        otpExpiry: null,
      },
    });

    return { message: 'Phone verified successfully' };
  }

  async approveAgent(dto: ApproveAgentDto) {
    const agent = await this.prisma.user.findUnique({
      where: { id: dto.agentId },
    });

    if (!agent || agent.role !== 'AGENT') {
      throw new BadRequestException('Agent not found');
    }

    // Update approval and commission
    const updated = await this.prisma.user.update({
      where: { id: dto.agentId },
      data: {
        isApproved: true,
      },
    });

    return {
      message: 'Agent approved successfully',
      agent: updated,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    // PHONE NOT REGISTERED
    if (!user) {
      throw new UnauthorizedException('Phone number does not exist');
    }

    // MISSING PASSWORD (should not happen normally)
    if (!user.passwordHash) {
      throw new UnauthorizedException('Password not set for this account');
    }

    // WRONG PASSWORD
    const valid = await comparePassword(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('Incorrect password');
    }

    // PHONE NOT VERIFIED
    if (!user.isPhoneVerified) {
      throw new UnauthorizedException('Please verify your phone number');
    }

    // AGENT NOT APPROVED
    if (user.role === Role.AGENT && !user.isApproved) {
      throw new UnauthorizedException('Your account is awaiting approval');
    }

    // generate tokens
    const { accessToken, refreshToken } = await this.generateTokenPair(
      user.id,
      user.role,
      {
        deviceId: dto.deviceId,
        ip: dto.ip,
        userAgent: dto.userAgent,
      },
    );

    return {
      message: 'Login successful',
      accessToken,
      refreshToken,
      deviceId: dto.deviceId,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved,
      },
    };
  }

  // --------------------------------------------
  // SEND FORGOT PASSWORD OTP
  // --------------------------------------------
  async forgotPassword(dto: ForgotPasswordDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (!user) {
      throw new BadRequestException('This phone number is not registered');
    }

    const otp = generateOtp();
    const otpExpiry = new Date(Date.now() + 5 * 60 * 1000);

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        otpCode: otp,
        otpExpiry,
      },
    });

    // TODO: send OTP SMS

    return { message: 'OTP sent for password reset' };
  }

  // --------------------------------------------
  // VERIFY OTP (FORGOT PASSWORD) AND ISSUE RESET TOKEN
  // --------------------------------------------
  async verifyForgotOtp(dto: VerifyForgotOtpDto) {
    const user = await this.prisma.user.findUnique({
      where: { phone: dto.phone },
    });

    if (!user) throw new BadRequestException('Invalid phone');

    if (user.otpCode !== dto.otp)
      throw new BadRequestException('Incorrect OTP');

    if (!user.otpExpiry || user.otpExpiry < new Date())
      throw new BadRequestException('OTP expired');

    // Create a short-lived reset token
    const resetToken = await this.jwtService.signAsync(
      { sub: user.id },
      { expiresIn: '10m' },
    );

    return {
      message: 'OTP verified',
      resetToken,
    };
  }

  // --------------------------------------------
  // RESET PASSWORD
  // --------------------------------------------
  async resetPassword(dto: ResetPasswordDto) {
    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(dto.resetToken);
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const userId = payload.sub;

    const passwordHash = await hashPassword(dto.newPassword);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        otpCode: null,
        otpExpiry: null,
      },
    });

    return { message: 'Password updated successfully' };
  }

  // -----------------------------
  // LIST USER DEVICES
  // -----------------------------
  async listDevices(userId: string) {
    return this.prisma.refreshToken.findMany({
      where: { userId },
      select: {
        id: true,
        deviceId: true,
        ip: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // -----------------------------
  // REVOKE (LOGOUT) A SPECIFIC DEVICE
  // -----------------------------
  async revokeDevice(userId: string, deviceId: string) {
    await this.prisma.refreshToken.deleteMany({
      where: { userId, deviceId },
    });

    return { message: 'Device revoked successfully' };
  }
}
