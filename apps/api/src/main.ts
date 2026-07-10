import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { loadEnv } from './config/env';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env.isProduction ? ['log', 'warn', 'error'] : ['log', 'warn', 'error', 'debug'],
  });

  app.use(helmet());
  app.use(cookieParser());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'x-ifn-csrf'],
  });
  app.enableShutdownHooks();

  await app.listen(env.API_PORT);
  const logger = new Logger('Bootstrap');
  logger.log(`API escuchando en http://localhost:${env.API_PORT}`);
  if (env.devLoginEnabled) {
    logger.warn('AUTH_DEV_LOGIN activo: ingreso de desarrollo habilitado (solo no-producción).');
  }
  if (!env.googleConfigured) {
    logger.warn('Google OAuth sin configurar: definí GOOGLE_CLIENT_ID/SECRET para login con Google.');
  }
}

void bootstrap();
