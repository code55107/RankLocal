import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { AuthGuard, extractBearerToken } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { AuthResponse, AuthUser } from './auth.types';

/**
 * Auth endpoints (backend-auth-spec.md). Responses are returned in the exact
 * shapes the frontend BFF expects — NOT wrapped in the audit `{ success, data }`
 * envelope.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Register with email + password' })
  register(@Body() dto: RegisterDto): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate with email + password' })
  login(@Body() dto: LoginDto): Promise<AuthResponse> {
    return this.auth.login(dto);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Invalidate the current session (idempotent)' })
  logout(@Req() req: Request): Promise<{ success: true }> {
    // Unguarded on purpose: logout must succeed even with an expired/invalid
    // token so the frontend can always clear its cookie.
    return this.auth.logout(extractBearerToken(req));
  }

  @Get('session')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the currently authenticated user' })
  session(@CurrentUser() user: AuthUser): { user: AuthUser } {
    return { user };
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a Google OAuth authorization code for a session' })
  google(@Body() dto: GoogleAuthDto): Promise<AuthResponse> {
    return this.auth.googleAuth(dto);
  }
}
