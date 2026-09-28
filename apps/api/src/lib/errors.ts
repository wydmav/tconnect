import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';

export class ApiError extends HttpException {
  constructor(statusCode: number, readonly msg: string) {
    super({ error: msg }, statusCode);
  }

  override get message(): string {
    return this.msg;
  }
}

@Catch()
export class AllErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    const statusCode =
      error instanceof HttpException ? error.getStatus() : 500;

    let message = 'internal error';

    if (error instanceof HttpException) {
      const body = error.getResponse();

      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body
      ) {
        message = String((body as { error: unknown }).error);
      } else if (typeof body === 'string') {
        message = body;
      } else {
        message = error.message;
      }
    } else if (error instanceof Error) {
      message = error.message;
    }

    if (statusCode >= 500) {
      console.error('[api]', error);
    }

    response.status(statusCode).json({ error: message });
  }
}
