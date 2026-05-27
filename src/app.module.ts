import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configValidationSchema } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { ExternalModule } from './external/external.module';
import { AuditModule } from './audit/audit.module';
import { HealthController } from './app.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: configValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.get<string>('NODE_ENV') === 'production' ? 'info' : 'debug',
          transport:
            config.get<string>('NODE_ENV') === 'production'
              ? undefined
              : { target: 'pino-pretty', options: { singleLine: true } },
          redact: ['req.headers.authorization', 'req.headers.cookie'],
        },
      }),
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot(
      // Global throttle is a cheap-reject layer. The real per-IP audit limit
      // (10/hour, configurable) is enforced inside AuditService against the
      // database — this just keeps an attacker from spamming /api/v1/audit
      // beyond the burst budget before Prisma is consulted.
      process.env.NODE_ENV === 'test'
        ? [{ name: 'default', ttl: 60_000, limit: 100_000 }]
        : [{ name: 'default', ttl: 60_000, limit: 30 }],
    ),
    PrismaModule,
    ExternalModule,
    AuditModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
