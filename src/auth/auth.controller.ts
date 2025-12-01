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

  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const { accessToken, refreshToken, user } =
      await this.authService.login(dto);

    // Web: set cookies
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    return { message: 'Login successful', accessToken, refreshToken, user };
  }

  @Post('refresh')
  async refresh(@Body('refreshToken') bodyToken: string, @Req() req) {
    // mobile: sent in body
    let token = bodyToken;

    // web: auto from cookie
    if (!token && req.cookies?.refresh_token) {
      token = req.cookies.refresh_token;
    }

    const result = await this.authService.refresh(token);
    return result;
  }

  @Post('logout')
  async logout(
    @Req() req,
    @Body('refreshToken') bodyToken: string,
    @Res({ passthrough: true }) res,
  ) {
    let token = bodyToken;

    // web reads from cookies
    if (!token && req.cookies?.refresh_token) {
      token = req.cookies.refresh_token;
    }

    await this.authService.logout(token);

    // clear cookies for web
    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.clearCookie('app_user');

    return { message: 'Logged out successfully' };
  }
}
