import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

/**
 * Thin Resend wrapper. The constructor lazily holds a client only when a key
 * is configured — in dev or CI without `RESEND_API_KEY` we no-op and log,
 * keeping `pnpm start:dev` usable end-to-end without a real Resend account.
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const apiKey = config.get<string>('RESEND_API_KEY');
    this.client = apiKey ? new Resend(apiKey) : null;
    this.from = config.get<string>('MAIL_FROM', 'RankLocal <audits@ranklocal.com>');
  }

  async sendAuditComplete(args: {
    to: string;
    businessName: string;
    auditUrl: string;
    overallScore: number;
  }): Promise<void> {
    if (!this.client) {
      this.log.warn(`RESEND_API_KEY not set — skipping email to ${args.to}`);
      return;
    }

    const subject = `Your SEO Audit: ${args.businessName} scored ${args.overallScore}/100`;
    const html = renderAuditCompleteHtml(args);

    try {
      await this.client.emails.send({
        from: this.from,
        to: args.to,
        subject,
        html,
      });
    } catch (err) {
      // Email send is non-critical; log and swallow so the audit still
      // completes from the caller's perspective.
      this.log.warn(`Resend send failed: ${(err as Error).message}`);
    }
  }
}

function renderAuditCompleteHtml(args: {
  businessName: string;
  auditUrl: string;
  overallScore: number;
}): string {
  // Minimal inline-styled template. Replace with a richer React-email or MJML
  // template once the design system lands.
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background:#f7f7f7; padding:24px;">
    <div style="max-width:560px; margin:0 auto; background:white; border-radius:8px; padding:32px;">
      <h1 style="margin:0 0 16px; font-size:24px;">Your audit is ready</h1>
      <p style="font-size:16px; line-height:1.5;">
        We finished auditing <strong>${escapeHtml(args.businessName)}</strong>.
        Your overall local SEO score is <strong>${args.overallScore}/100</strong>.
      </p>
      <p style="margin:32px 0;">
        <a href="${args.auditUrl}" style="background:#111; color:white; padding:12px 24px; border-radius:6px; text-decoration:none; display:inline-block;">
          View your report
        </a>
      </p>
      <p style="font-size:13px; color:#666;">
        This is a free local SEO audit from RankLocal. If the button above doesn't work, paste this link in your browser:<br/>
        <a href="${args.auditUrl}" style="color:#666;">${args.auditUrl}</a>
      </p>
    </div>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
