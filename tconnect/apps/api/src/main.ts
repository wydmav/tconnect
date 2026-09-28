import { Module } from '@nestjs/common';
import { SetupController } from './setup.controller';
import { AuthController } from './auth.controller';
import { SitesController } from './sites.controller';
import { RoutersController, AdoptController, AgentController } from './routers.controller';
import { PlansController } from './plans.controller';
import { VouchersController } from './vouchers.controller';
import { TeamController, InvitesPublicController } from './team.controller';
import { RolesController } from './roles.controller';
import { StatsController } from './stats.controller';
import { HealthController } from './health.controller';

@Module({ controllers: [
  SetupController, AuthController, SitesController, RoutersController, AdoptController,
  AgentController, PlansController, VouchersController, TeamController, InvitesPublicController,
  RolesController, StatsController, HealthController,
] })
export class AppModule {}