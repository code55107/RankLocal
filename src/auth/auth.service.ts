import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Provider, User } from '@prisma/client';
import { PrismaService } from '@/prisma/prisma.service';
import {
  EmailExistsException,
  InvalidCredentialsException,
} from '@/common/exceptions/custom.exceptions';
import { newSessionToken, newUserId } from '@/common/utils/ids';
import { AuthResponse, AuthUser } from './auth.types';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { GoogleOAuthService } from './google-oauth.service';

const BCRYPT_COST = 12;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly google: GoogleOAuthService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const email = normalizeEmail(dto.email);
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new EmailExistsException();

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_COST);
    const user = await this.prisma.user.create({
      data: {
        id: newUserId(),
        email,
        name: dto.name,
        provider: Provider.email,
        password: passwordHash,
      },
    });

    return this.issueSession(user);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const email = normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Same error whether the email is unknown or the password is wrong, and
    // whether the account is Google-only (no password set).
    if (!user || !user.password) throw new InvalidCredentialsException();

    const ok = await bcrypt.compare(dto.password, user.password);
    if (!ok) throw new InvalidCredentialsException();

    return this.issueSession(user);
  }

  /** Idempotent — deleting an unknown/already-gone token is a no-op so the
   *  frontend can always clear its cookie and move on. */
  async logout(token: string | null): Promise<{ success: true }> {
    if (token) {
      await this.prisma.session.deleteMany({ where: { token } });
    }
    return { success: true };
  }

  /** Resolves a bearer token to its principal, or null if missing/expired.
   *  Expired sessions are deleted opportunistically. */
  async validateSession(token: string): Promise<AuthUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });
    if (!session) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { token } });
      return null;
    }
    return toAuthUser(session.user);
  }

  async googleAuth(dto: GoogleAuthDto): Promise<AuthResponse> {
    const profile = await this.google.exchangeCode(dto.code, dto.redirectUri);
    const email = normalizeEmail(profile.email);

    // Find-or-create keyed on email so a pre-existing email/password account
    // links to the Google identity rather than colliding on the unique index.
    const existing = await this.prisma.user.findUnique({ where: { email } });
    const user = existing
      ? await this.prisma.user.update({
          where: { id: existing.id },
          // Backfill avatar from Google when we don't already have one.
          data: { avatarUrl: existing.avatarUrl ?? profile.picture },
        })
      : await this.prisma.user.create({
          data: {
            id: newUserId(),
            email,
            name: profile.name,
            avatarUrl: profile.picture,
            provider: Provider.google,
          },
        });

    return this.issueSession(user);
  }

  private async issueSession(user: User): Promise<AuthResponse> {
    const token = newSessionToken();
    await this.prisma.session.create({
      data: {
        token,
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
    return { token, user: toAuthUser(user) };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    provider: user.provider,
  };
}
