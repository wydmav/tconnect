import { Controller, Get } from '@nestjs/common';
import { pool } from './lib/db';
@Controller() export class HealthController {
  @Get('healthz') health() { return { ok: true }; }
  @Get('readyz') async ready() { await pool.query('SELECT 1'); return { ok: true }; }
}