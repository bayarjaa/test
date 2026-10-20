import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessClaims } from '../auth/jwt';
import { ensureLocalUser } from '../common/local-user';
import { firstAttr } from '../iam/catalog';
import { KeycloakAdminService } from '../iam/keycloak-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';

class ActiveOrganizationDto {
  @IsUUID() organizationId: string;
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kc: KeycloakAdminService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async me(@CurrentUser() actor: AccessClaims) {
    const local = await ensureLocalUser(this.prisma, actor.sub);
    const profile = await this.kc.getUser(actor.sub);
    const organizations = await this.organizations(actor);
    const positions = await this.users.positions(actor.sub);
    return {
      id: local.id,
      keycloakId: actor.sub,
      username: profile?.username || actor.preferredUsername,
      email: profile?.email || actor.email,
      firstName: profile?.firstName,
      lastName: profile?.lastName,
      activeOrganizationId: local.activeOrganizationId,
      organizations,
      positions,
    };
  }

  @Get('organizations')
  async organizations(@CurrentUser() actor: AccessClaims) {
    const orgs = await this.kc.organizationsForMember(actor.sub);
    return orgs.map((org) => ({
      id: org.id,
      name: org.name,
      alias: org.alias,
      code: firstAttr(org.attributes, 'code'),
      orgType: firstAttr(org.attributes, 'org_type'),
      parentOrganizationId: firstAttr(org.attributes, 'parent_organization_id'),
    }));
  }

  @Post('active-organization')
  async setActive(@CurrentUser() actor: AccessClaims, @Body() dto: ActiveOrganizationDto) {
    const member = await this.kc.isMember(dto.organizationId, actor.sub);
    if (!member) throw new BadRequestException('not_member');
    await ensureLocalUser(this.prisma, actor.sub);
    const local = await this.prisma.user.update({
      where: { keycloakId: actor.sub },
      data: { activeOrganizationId: dto.organizationId },
    });
    return { activeOrganizationId: local.activeOrganizationId };
  }
}
