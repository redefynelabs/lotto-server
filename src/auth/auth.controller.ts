import {
  Controller,
  Post,
  Body,
  Patch,
  UseGuards,
  Res,
  Req,
} from '@nestjs/common';
import express from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { ApproveAgentDto } from './dto/approve-agent.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('verify')
  async verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto);
  }

  @Patch('agents/approve')
  @UseGuards(JwtAuthGuard, AdminGuard)
  async approveAgent(@Body() dto: ApproveAgentDto) {
    return this.authService.approveAgent(dto);
  }

  // in AuthController

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: express.Response,
    @Req() req: any,
  ) {
    const ip = req.ip;
    const ua = req.get('user-agent');
    const deviceId = (dto as any).deviceId; // optional: client can send deviceId

    const { accessToken, refreshToken, user } = await this.authService.login({
      ...dto,
      // pass metadata so new refresh row includes it
      deviceId,
      ip,
      userAgent: ua,
    } as any);

    const isProd = process.env.NODE_ENV === 'production';

    // cookies (unchanged)
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProd,
      maxAge: 15 * 60 * 1000,
      sameSite: isProd ? 'none' : 'lax',
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    });
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: isProd ? 'none' : 'lax',
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    });
    res.cookie('app_user', JSON.stringify(user), {
      secure: process.env.NODE_ENV === 'production',
      sameSite: isProd ? 'none' : 'lax',
      domain: isProd ? '.redefyne.in' : undefined,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    return { message: 'Login successful', accessToken, refreshToken, user };
  }

  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const token = bodyToken || req.cookies?.refresh_token;
    const ip = req.ip;
    const ua = req.get('user-agent');
    const deviceId = req.body?.deviceId;

    const { accessToken, refreshToken } = await this.authService.refresh(
      token,
      { deviceId, ip, userAgent: ua },
    );

    const isProd = process.env.NODE_ENV === 'production';

    if (req.cookies?.refresh_token) {
      res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: isProd,
        maxAge: 15 * 60 * 1000,
        sameSite: isProd ? 'none' : 'lax',
        domain: isProd ? '.redefyne.in' : undefined,
        path: '/',
      });
      res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProd,
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: isProd ? 'none' : 'lax',
        domain: isProd ? '.redefyne.in' : undefined,
        path: '/',
      });
    }

    return { accessToken, refreshToken };
  }

  @Post('logout')
  async logout(
    @Body('refreshToken') bodyToken: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const isProd = process.env.NODE_ENV === 'production';

    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    };

    const token = bodyToken || req.cookies?.refresh_token;

    // if using JwtAuthGuard you can get userId from req.user
    const userId = req.user?.userId;

    await this.authService.logout(token, userId);

    // CLEAR COOKIES (using SAME OPTIONS)
    res.clearCookie('access_token', cookieOptions);
    res.clearCookie('refresh_token', cookieOptions);
    res.clearCookie('app_user', {
      ...cookieOptions,
      httpOnly: false,
    });

    return { message: 'Logged out' };
  }
}
