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

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

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

    const token = await this.jwtService.signAsync({
      sub: user.id,
      role: user.role,
    });

    return {
      message: 'Login successful',
      accessToken: token,
      user,
    };
  }
}
