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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  // --- Helper to create JWTs
  private async createAccessToken(userId: string, role: string) {
    return this.jwtService.signAsync(
      { sub: userId, role },
      { expiresIn: '15m' },
    );
  }

  // If you want stronger refresh tokens, you can sign with a jti or nonce
  private async createRefreshToken(userId: string) {
    // include a jti to make token rotation easier to track if needed
    return this.jwtService.signAsync(
      { sub: userId, jti: uuidv4() },
      { expiresIn: '7d' },
    );
  }

  /**
   * Generate token pair and store refresh token (rotate/replace existing).
   * This method *replaces* any existing refresh token for the user.
   */
  async generateTokenPair(userId: string, role: string) {
    const accessToken = await this.createAccessToken(userId, role);
    const refreshToken = await this.createRefreshToken(userId);

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.refreshToken.create({
        data: {
          userId,
          token: refreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    });


    return { accessToken, refreshToken };
  }

  // Refresh token flow
  async refresh(oldRefreshToken: string) {
    if (!oldRefreshToken) {
      throw new UnauthorizedException('Missing refresh token');
    }

    // Find stored token record
    const stored = await this.prisma.refreshToken.findUnique({
      where: { token: oldRefreshToken },
    });

    if (!stored) {
      // possible reuse/attempted reuse -> reject
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt < new Date()) {
      // remove expired token
      await this.prisma.refreshToken.deleteMany({
        where: { token: oldRefreshToken },
      });
      throw new UnauthorizedException('Refresh token expired');
    }

    // At this point token is valid. Rotate it: issue a new refresh token and new access token.
    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    const newAccessToken = await this.createAccessToken(
      stored.userId,
      user?.role || Role.AGENT,
    );
    const newRefreshToken = await this.createRefreshToken(stored.userId);

    // Replace token atomically
    await this.prisma.$transaction([
      this.prisma.refreshToken.deleteMany({
        where: { token: oldRefreshToken },
      }),
      this.prisma.refreshToken.create({
        data: {
          userId: stored.userId,
          token: newRefreshToken,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      }),
    ]);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken, // return rotated refresh token to client
    };
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

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.passwordHash)
      throw new UnauthorizedException('Invalid credentials');

    // Check password
    const valid = await comparePassword(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    // Phone must be verified
    if (!user.isPhoneVerified)
      throw new UnauthorizedException('Phone not verified');

    // Agent must be approved
    if (user.role === Role.AGENT && !user.isApproved)
      throw new UnauthorizedException('Agent not approved');

    // generate pair and persist refresh token
    const { accessToken, refreshToken } = await this.generateTokenPair(
      user.id,
      user.role,
    );

    return {
      message: 'Login successful',
      accessToken,
      refreshToken,
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

  // Logout and delete refresh token
  async logout(refreshToken: string | null, userId?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.deleteMany({
        where: { token: refreshToken },
      });
    } else if (userId) {
      // fallback: delete all tokens for user
      await this.prisma.refreshToken.deleteMany({ where: { userId } });
    }

    return { message: 'Logged out successfully' };
  }
}
