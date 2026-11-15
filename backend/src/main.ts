import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { runBootMigrations } from './database/boot-migrations';

async function bootstrap() {
  // Bring the schema up to date BEFORE Nest starts. TypeORM's `synchronize`
  // is off, so every module's entities assume their tables already exist —
  // creating them after the application booted would leave the first
  // requests querying missing relations. A failure here is fatal on purpose:
  // starting with a half-migrated database is worse than not starting.
  await runBootMigrations();

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'],
    bodyParser: true,
  });

  // Trust the nginx reverse proxy's X-Forwarded-* headers (single hop — nginx
  // is the only thing in front of this container). Without this, req.secure
  // is always false behind a proxy, which would prevent the refresh-token
  // cookie from ever being marked Secure even when the browser is on HTTPS.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // Increase body size limit for file uploads
  app.use((req, res, next) => {
    if (req.path === '/api/uploads') {
      // Skip body parsing for upload endpoint (handled by multer)
      return next();
    }
    next();
  });

  // Security headers. HSTS is off deliberately: it's served over the same
  // response regardless of which port reached it, and Helmet's default is a
  // 1-year max-age. Turning it on now — while the LAN IP/cert setup for the
  // AI/ML Network is still new — would mean any browser that ever loads this
  // over HTTPS refuses plain HTTP for a year, with no user-facing override,
  // if the cert or address needs to change before it's stable. Revisit once
  // the network-side DNS/TLS setup has been running smoothly for a while.
  app.use(helmet({ hsts: false }));

  // Cookie parser for refresh token httpOnly cookies
  app.use(cookieParser());

  // Global validation pipe – strips unknown fields, auto-transforms
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false, // Changed to false to allow file uploads
      transform: true,
    }),
  );

  // CORS – allow frontend origins in dev (VS Code port-forward, nginx proxy, direct)
  const allowedOrigins = (process.env.FRONTEND_URL ?? 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim());
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (curl, Postman, server-to-server)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // Global /api prefix
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`✅  AI-Server backend running on http://localhost:${port}/api`);
}

bootstrap();
