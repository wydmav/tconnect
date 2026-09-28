import { ExceptionFilter, Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { Response } from 'express';
export class ApiError extends HttpException {
  constructor(readonly status: number, readonly msg: string) { super({ error: msg }, status); }
  get message() { return this.msg; }
}
@Catch()
export class AllErrors implements ExceptionFilter {
  catch(e: any, ctx: ArgumentsHost) {
    const res = ctx.switchToHttp().getResponse<Response>();
    const status = e instanceof HttpException ? e.getStatus() : 500;
    const msg = e instanceof HttpException ? (e.getResponse() as any).error ?? e.message : 'internal error';
    if (status >= 500) console.error('[api]', e);
    res.status(status).json({ error: typeof msg === 'string' ? msg : 'error' });
  }
}