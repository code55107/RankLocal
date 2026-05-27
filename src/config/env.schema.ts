import * as Joi from 'joi';

export const configValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3001),

  PUBLIC_API_URL: Joi.string().uri().default('http://localhost:3001'),
  FRONTEND_URL: Joi.string().uri().default('http://localhost:3000'),

  // Postgres DSN — Prisma reads `process.env.DATABASE_URL` directly.
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  // Google Places API (New). Used for search / details / nearby.
  GOOGLE_PLACES_API_KEY: Joi.string().required(),
  // PageSpeed Insights — same key family but billed separately, kept distinct
  // so a quota issue on one doesn't break the other.
  GOOGLE_PAGESPEED_API_KEY: Joi.string().required(),

  ANTHROPIC_API_KEY: Joi.string().required(),

  // Resend is optional — pipeline still completes if mail fails. Joi keeps it
  // optional so dev environments without a key can still run audits end-to-end.
  RESEND_API_KEY: Joi.string().optional().allow(''),
  MAIL_FROM: Joi.string().default('RankLocal <audits@ranklocal.com>'),

  // Pipeline ceiling — stale audits past this are reaped by the cron in
  // AuditCleanupService and marked `failed` / `timeout`.
  AUDIT_TIMEOUT_MS: Joi.number().integer().min(10_000).default(120_000),
  RATE_LIMIT_MAX_PER_HOUR: Joi.number().integer().min(1).default(10),

  CORS_ORIGINS: Joi.string().required(),
});
