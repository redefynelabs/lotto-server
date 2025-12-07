import {
  Controller,
  Post,
  Body,
  Patch,
  UseGuards,
  Res,
  Req,
  BadRequestException,
  Get,
  Delete,
  Param,
  UnauthorizedException,
} from '@nestjs/common';
import express from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AdminGuard } from './guards/admin.guard';
import { ApproveAgentDto } from './dto/approve-agent.dto';
import {
  extractDeviceId,
  extractRealIp,
  extractUserAgent,
} from 'src/utils/request.util';
import {
  ForgotPasswordDto,
  ResetPasswordDto,
  VerifyForgotOtpDto,
} from './dto/forgot-password.dto';

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

  // -----------------------------------------------------
  // LOGIN
  // -----------------------------------------------------
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    // ----------------------------------------------------
    // Extract data safely
    // ----------------------------------------------------
    const ip = extractRealIp(req);
    const userAgent = extractUserAgent(req);
    const deviceId = extractDeviceId(req, dto);

    // console.log('Body data:', dto);
    // console.log(dto.deviceId); // shows actual string
    // console.log(dto.userAgent);
    // ----------------------------------------------------
    // Call service
    // ----------------------------------------------------
    const { accessToken, refreshToken, user } = await this.authService.login({
      ...dto,
      deviceId,
      ip,
      userAgent,
    });

    // ----------------------------------------------------
    // Cookies for web
    // ----------------------------------------------------
    const isProd = process.env.NODE_ENV === 'production';
    const sameSite = (isProd ? 'none' : 'lax') as any;

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProd,
      maxAge: 15 * 60 * 1000,
      sameSite,
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite,
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    });

    // Set readable deviceId cookie (browser only)
    res.cookie('x-device-id', deviceId, {
      httpOnly: false,
      secure: isProd,
      maxAge: 365 * 24 * 60 * 60 * 1000,
      sameSite,
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    });

    const safeUser = {
      id: user.id,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      email: user.email,
      isApproved: user.isApproved,
    };

    // encodeURIComponent to avoid cookie-parsing issues (quotes, spaces)
    const encoded = encodeURIComponent(JSON.stringify(safeUser));

    // Note: httpOnly: false so middleware running on Edge can read the cookie.
    res.cookie('app_user', encoded, {
      httpOnly: false,
      secure: isProd,
      maxAge: 7 * 24 * 60 * 60 * 1000, // same lifetime as refresh token or adjust
      sameSite,
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    });

    return {
      message: 'Login successful',
      accessToken,
      refreshToken,
      user,
      deviceId,
    };
  }

  // -----------------------------------------------------
  // REFRESH
  // -----------------------------------------------------
  @Post('refresh')
  async refresh(
    @Body('refreshToken') bodyToken: string,
    @Body('deviceId') bodyDeviceId: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    // console.log('🔥 ---- REFRESH DEBUG ----');
    // console.log('req.cookies:', req.cookies);
    // console.log('req.body:', req.body);
    // console.log('req.headers:', req.headers);

    const token = bodyToken || req.cookies?.refresh_token;

    // console.log('👉 Chosen refresh token:', token);\
    
    if (!token) throw new BadRequestException('No refresh token provided');

    // robust IP extraction
    const forwarded = (req.headers['x-forwarded-for'] as string) || '';
    const ip =
      forwarded.split(',').shift() || req.connection?.remoteAddress || req.ip;

    const ua = req.get('user-agent') ?? undefined;

    const deviceId =
      bodyDeviceId ||
      (req.headers['x-device-id'] as string) ||
      (req.cookies?.['x-device-id'] as string) ||
      undefined;

    try {
      const { accessToken, refreshToken } = await this.authService.refresh(
        token,
        {
          deviceId,
          ip,
          userAgent: ua,
        },
      );

      const isProd = process.env.NODE_ENV === 'production';
      const sameSite = (isProd ? 'none' : 'lax') as 'none' | 'lax';

      // Lifetimes (ms)
      const ACCESS_TOKEN_MS = 15 * 60 * 1000; // 15 minutes
      const REFRESH_TOKEN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
      const APP_USER_MS = REFRESH_TOKEN_MS;
      const DEVICE_COOKIE_MS = 365 * 24 * 60 * 60 * 1000; // 1 year

      // Update httpOnly token cookies
      res.cookie('access_token', accessToken, {
        httpOnly: true,
        secure: isProd,
        maxAge: ACCESS_TOKEN_MS,
        sameSite,
        domain: isProd ? '.redefyne.in' : undefined,
        path: '/',
      });

      res.cookie('refresh_token', refreshToken, {
        httpOnly: true,
        secure: isProd,
        maxAge: REFRESH_TOKEN_MS,
        sameSite,
        domain: isProd ? '.redefyne.in' : undefined,
        path: '/',
      });

      // Update device cookie (accessible by JS)
      if (deviceId) {
        res.cookie('x-device-id', deviceId, {
          httpOnly: false,
          secure: isProd,
          maxAge: DEVICE_COOKIE_MS,
          sameSite,
          domain: isProd ? '.redefyne.in' : undefined,
          path: '/',
        });
      }

      // ----------------------------
      // SET / UPDATE app_user cookie
      // ----------------------------
      let safeUser: any = null;
      try {
        safeUser = await this.authService.getUserFromAccessToken(accessToken);
      } catch (err) {
        safeUser = null;
      }

      if (safeUser) {
        const minimal = {
          id: safeUser.id,
          role: safeUser.role,
          firstName: safeUser.firstName,
          lastName: safeUser.lastName,
          phone: safeUser.phone,
          email: safeUser.email,
          isApproved: safeUser.isApproved,
        };
        const encoded = encodeURIComponent(JSON.stringify(minimal));

        res.cookie('app_user', encoded, {
          httpOnly: false,
          secure: isProd,
          maxAge: APP_USER_MS,
          sameSite,
          domain: isProd ? '.redefyne.in' : undefined,
          path: '/',
        });
      }

      // Return tokens also in JSON so clients that don't use cookies can store them
      return { accessToken, refreshToken, deviceId };
    } catch (err: any) {
      // Clear cookies on failure (use same path/domain options to ensure removal)
      const cookieOptions: express.CookieOptions = { path: '/' };
      res.clearCookie('access_token', cookieOptions);
      res.clearCookie('refresh_token', cookieOptions);
      res.clearCookie('app_user', cookieOptions);
      res.clearCookie('x-device-id', cookieOptions);

      throw new UnauthorizedException(err?.message || 'Refresh token invalid');
    }
  }

  // -----------------------------------------------------
  // LOGOUT
  // -----------------------------------------------------
  @Post('logout')
  async logout(
    @Body('refreshToken') bodyToken: string,
    @Req() req: any,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const isProd = process.env.NODE_ENV === 'production';
    const sameSite = (isProd ? 'none' : 'lax') as 'none' | 'lax';

    const cookieOptions = {
      httpOnly: true,
      secure: isProd,
      sameSite,
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    };

    const token = bodyToken || req.cookies?.refresh_token;
    const userId = req.user?.userId;

    await this.authService.logout(token, userId);

    // Clear cookies
    res.clearCookie('access_token', cookieOptions);
    res.clearCookie('refresh_token', cookieOptions);
    res.clearCookie('app_user', { ...cookieOptions, httpOnly: false });
    res.clearCookie('x-device-id', {
      httpOnly: false,
      secure: isProd,
      sameSite,
      domain: isProd ? '.redefyne.in' : undefined,
      path: '/',
    });

    return { message: 'Logged out' };
  }

  // -----------------------------------------------------
  // FORGOT PASSWORD - SEND OTP
  // -----------------------------------------------------
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  // -----------------------------------------------------
  // VERIFY OTP FOR FORGOT PASSWORD
  // -----------------------------------------------------
  @Post('forgot-password/verify')
  async verifyForgotOtp(@Body() dto: VerifyForgotOtpDto) {
    return this.authService.verifyForgotOtp(dto);
  }

  // -----------------------------------------------------
  // RESET PASSWORD
  // -----------------------------------------------------
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  // -----------------------------
  // GET ALL DEVICES
  // -----------------------------
  @Get('devices')
  @UseGuards(JwtAuthGuard)
  async getDevices(@Req() req: any) {
    const userId = req.user?.userId;
    return this.authService.listDevices(userId);
  }

  // -----------------------------
  // REVOKE A DEVICE BY deviceId
  // -----------------------------
  @Delete('devices/:deviceId')
  @UseGuards(JwtAuthGuard)
  async revokeDevice(@Req() req: any, @Param('deviceId') deviceId: string) {
    const userId = req.user?.userId;
    return this.authService.revokeDevice(userId, deviceId);
  }
}
