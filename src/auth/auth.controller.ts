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

    // set cookies for web
    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 15 * 60 * 1000,
      sameSite: 'none',
      path: '/',
    });
    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'none',
      path: '/',
    });
    res.cookie('app_user', JSON.stringify(user), {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    // return tokens too for mobile
    return { message: 'Login successful', accessToken, refreshToken, user };
  }

  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const token = bodyToken || req.cookies?.refresh_token;
    const { accessToken, refreshToken } = await this.authService.refresh(token);

    // if request came from web cookie flow, update cookies
    if (req.cookies?.refresh_token) {
      res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 15 * 60 * 1000,
        sameSite: 'none',
        path: '/',
      });
      res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        sameSite: 'none',
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
    const token = bodyToken || req.cookies?.refresh_token;
    // optionally if req.user available, pass userId too
    await this.authService.logout(token, req.user?.userId);

    res.clearCookie('access_token');
    res.clearCookie('refresh_token');
    res.clearCookie('app_user');

    return { message: 'Logged out' };
  }
}
