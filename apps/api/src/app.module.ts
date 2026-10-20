import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AccessController } from './access/access.controller';
import { AccessService } from './access/access.service';
import { JwtAuthGuard } from './auth/auth.guard';
import { BudgetsController } from './budgets/budgets.controller';
import { BudgetsService } from './budgets/budgets.service';
import { DashboardController } from './dashboard/dashboard.controller';
import { HealthController } from './health.controller';
import { AuthorizationService } from './iam/authorization.service';
import { IamGateway } from './iam/iam.gateway';
import { KeycloakAdminService } from './iam/keycloak-admin.service';
import { PermissionCache } from './iam/permission-cache';
import { MeController } from './me/me.controller';
import { OrganizationsController } from './organizations/organizations.controller';
import { OrganizationsService } from './organizations/organizations.service';
import { PrismaService } from './prisma/prisma.service';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot()],
  controllers: [
    HealthController,
    MeController,
    OrganizationsController,
    UsersController,
    AccessController,
    BudgetsController,
    DashboardController,
  ],
  providers: [
    PrismaService,
    PermissionCache,
    KeycloakAdminService,
    { provide: IamGateway, useExisting: KeycloakAdminService },
    AuthorizationService,
    OrganizationsService,
    UsersService,
    AccessService,
    BudgetsService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
