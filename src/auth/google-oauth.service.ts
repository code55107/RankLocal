import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleErrorException, InvalidCodeException } from '@/common/exceptions/custom.exceptions';

export interface GoogleProfile {
  email: string;
  name: string;
  picture: string | null;
}

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';

/**
 * Server-side Google OAuth authorization-code exchange. The frontend BFF runs
 * the browser redirect and hands us the one-time `code` + the exact
 * `redirectUri` it used (Google requires them to match). We swap that for an
 * access token and fetch the user's profile.
 */
@Injectable()
export class GoogleOAuthService {
  private readonly log = new Logger(GoogleOAuthService.name);

  constructor(private readonly config: ConfigService) {}

  async exchangeCode(code: string, redirectUri: string): Promise<GoogleProfile> {
    const clientId = this.config.get<string>('GOOGLE_CLIENT_ID');
    const clientSecret = this.config.get<string>('GOOGLE_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      this.log.error('GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not configured');
      throw new GoogleErrorException('Google sign-in is not configured');
    }

    const accessToken = await this.fetchAccessToken({
      code,
      redirectUri,
      clientId,
      clientSecret,
    });
    return this.fetchProfile(accessToken);
  }

  private async fetchAccessToken(args: {
    code: string;
    redirectUri: string;
    clientId: string;
    clientSecret: string;
  }): Promise<string> {
    const body = new URLSearchParams({
      code: args.code,
      client_id: args.clientId,
      client_secret: args.clientSecret,
      redirect_uri: args.redirectUri,
      grant_type: 'authorization_code',
    });

    let res: Response;
    try {
      res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (err) {
      this.log.error(`Google token endpoint unreachable: ${(err as Error).message}`);
      throw new GoogleErrorException();
    }

    if (!res.ok) {
      // Google returns 400 + `error: invalid_grant` for a bad/expired/reused
      // code. Anything else (401/5xx) is a server-side problem.
      if (res.status === 400) throw new InvalidCodeException();
      this.log.error(`Google token exchange failed (${res.status})`);
      throw new GoogleErrorException();
    }

    const json = (await res.json()) as { access_token?: string };
    if (!json.access_token) {
      this.log.error('Google token response missing access_token');
      throw new GoogleErrorException();
    }
    return json.access_token;
  }

  private async fetchProfile(accessToken: string): Promise<GoogleProfile> {
    let res: Response;
    try {
      res = await fetch(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      this.log.error(`Google userinfo unreachable: ${(err as Error).message}`);
      throw new GoogleErrorException();
    }

    if (!res.ok) {
      this.log.error(`Google userinfo failed (${res.status})`);
      throw new GoogleErrorException();
    }

    const profile = (await res.json()) as {
      email?: string;
      name?: string;
      picture?: string;
    };
    if (!profile.email) {
      this.log.error('Google profile missing email');
      throw new GoogleErrorException();
    }

    return {
      email: profile.email,
      name: profile.name ?? profile.email.split('@')[0],
      picture: profile.picture ?? null,
    };
  }
}
