import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BadRequestException, ValidationError, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: config
      .get<string>('CORS_ORIGINS', '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      // Emit the VALIDATION_ERROR contract code (rather than the default
      // "Bad Request") so the frontend's normalizeBackendError() can branch
      // on it. Flattens all field messages into one string.
      exceptionFactory: (errors: ValidationError[]) =>
        new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: flattenValidationErrors(errors).join('; '),
        }),
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('RankLocal API')
    .setDescription('RankLocal backend — local SEO audit engine')
    .setVersion('1.0')
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.get<number>('PORT', 3001);
  // Bind 0.0.0.0 so PaaS port scanners see the socket (Node defaults to localhost).
  await app.listen(port, '0.0.0.0');
}

/** Depth-first collect every constraint message across nested validation errors. */
function flattenValidationErrors(errors: ValidationError[]): string[] {
  const out: string[] = [];
  const walk = (errs: ValidationError[]): void => {
    for (const e of errs) {
      if (e.constraints) out.push(...Object.values(e.constraints));
      if (e.children?.length) walk(e.children);
    }
  };
  walk(errors);
  return out.length > 0 ? out : ['Validation failed'];
}

bootstrap();
