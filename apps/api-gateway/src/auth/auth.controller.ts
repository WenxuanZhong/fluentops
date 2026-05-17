import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response, CookieOptions } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RegisterDto, LoginDto } from './dto';
import type { AuthenticatedRequest } from '../common/authenticated-request';

const REFRESH_COOKIE = 'fo_refresh';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
    private jwt: JwtService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Register a new user' })
  @ApiResponse({ status: 201, description: 'User created' })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  @ApiOperation({ summary: 'Login with email and password' })
  @ApiResponse({ status: 200, description: 'Returns access token; refresh is set as an httpOnly cookie' })
  @ApiResponse({ status: 401, description: 'Invalid credentials' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'Rotate refresh token (reads httpOnly cookie)' })
  @ApiResponse({ status: 200, description: 'Returns new access token, refresh cookie is rotated' })
  @ApiResponse({ status: 401, description: 'Invalid or revoked refresh token' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string } = {},
  ) {
    const token = readCookie(req, REFRESH_COOKIE) ?? body.refreshToken;
    if (!token) {
      throw new UnauthorizedException('Missing refresh token');
    }
    const tokens = await this.authService.refresh(token);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke refresh token and clear cookie' })
  @ApiResponse({ status: 204, description: 'Token revoked' })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string } = {},
  ) {
    const token = readCookie(req, REFRESH_COOKIE) ?? body.refreshToken;
    if (token) {
      await this.authService.logout(token);
    }
    res.clearCookie(REFRESH_COOKIE, this.refreshCookieOptions());
  }

  @Post('ws-ticket')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  @ApiOperation({ summary: 'Issue a short-lived WebSocket ticket' })
  async wsTicket(@Req() req: AuthenticatedRequest) {
    const ttl = this.config.get<string>('WS_TICKET_TTL') || '60s';
    const ticket = this.jwt.sign(
      { sub: req.user.id, kind: 'ws' },
      {
        secret: this.config.get<string>('JWT_SECRET'),
        expiresIn: Math.floor(parseTtlMs(ttl) / 1000),
      },
    );
    const expiresAt = new Date(Date.now() + parseTtlMs(ttl)).toISOString();
    return { ticket, expiresAt };
  }

  // ---- helpers ----

  private refreshCookieOptions(): CookieOptions {
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    const ttlMs = parseTtlMs(this.config.get<string>('REFRESH_TOKEN_TTL') || '7d');
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'none' : 'lax',
      maxAge: ttlMs,
      path: '/api/v1/auth',
      domain: this.config.get<string>('COOKIE_DOMAIN') || undefined,
    };
  }

  private setRefreshCookie(res: Response, refreshToken: string) {
    res.cookie(REFRESH_COOKIE, refreshToken, this.refreshCookieOptions());
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return rest.join('=');
      }
    }
  }
  return undefined;
}

function parseTtlMs(ttl: string): number {
  const match = ttl.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const [, num, unit] = match;
  const n = parseInt(num, 10);
  switch (unit) {
    case 's': return n * 1000;
    case 'm': return n * 60 * 1000;
    case 'h': return n * 60 * 60 * 1000;
    case 'd': return n * 24 * 60 * 60 * 1000;
    default: return 7 * 24 * 60 * 60 * 1000;
  }
}
