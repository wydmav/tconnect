import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import { randomBytes } from 'node:crypto';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { COOKIE_SECURE } from './env';
import { AllErrors } from './lib/errors';
import { runMigrations } from './migrate';

async function bootstrap(): Promise<void> {
  await runMigrations();

  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });

  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: {
        policy: 'same-site',
      },
    }),
  );

  app.use(
    express.json({
      limit: '256kb',
      type: 'application/json',
    }),
  );

  app.use(
    express.text({
      limit: '256kb',
      type: () => true,
    }),
  );

  app.use(cookieParser());

  app.use(
    (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      if (!req.cookies?.tc_csrf) {
        const token = randomBytes(24).toString('base64url');

        res.cookie('tc_csrf', token, {
          httpOnly: false,
          secure: COOKIE_SECURE,
          sameSite: 'lax',
          path: '/',
        });

        req.cookies = {
          ...req.cookies,
          tc_csrf: token,
        };
      }

      const isMutation =
        req.path.startsWith('/api') &&
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method);

      if (isMutation) {
        const cookieToken = req.cookies?.tc_csrf;
        const headerToken = req.headers['x-csrf-token'];

        if (
          !cookieToken ||
          typeof headerToken !== 'string' ||
          cookieToken !== headerToken
        ) {
          res.status(403).json({
            error: 'csrf check failed',
          });
          return;
        }
      }

      next();
    },
  );

  app.useGlobalFilters(new AllErrors());

  await app.listen(3000, '0.0.0.0');

  console.log('[api] listening on :3000');
}

bootstrap().catch((error: unknown) => {
  console.error('[api] startup failed', error);
  process.exit(1);
});
