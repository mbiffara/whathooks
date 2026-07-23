import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true preserves the unparsed request body so the Stripe webhook
  // controller can verify signatures against the exact bytes Stripe sent.
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    rawBody: true,
  });
  const config = app.get(ConfigService);

  app.setGlobalPrefix('v1');
  // WEB_ORIGIN may be a comma-separated list (e.g. apex + www) — each request's
  // Origin is matched against the list and reflected back when allowed.
  const origins = config
    .get<string>('WEB_ORIGIN', 'http://localhost:3000')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = config.get<number>('PORT', 3001);
  // SIGTERM (deploy roll) must close WhatsApp sockets + release the session
  // leadership lock so the incoming task can take over in seconds.
  app.enableShutdownHooks();
  await app.listen(port);

  console.log(`whathooks api listening on http://localhost:${port}/v1`);
}
void bootstrap();
