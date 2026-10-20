import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessClaims } from '../auth/jwt';
import { AuthorizationService } from '../iam/authorization.service';
import { OrganizationsService } from './organizations.service';

class CreateOrganizationDto {
  @IsString() @MaxLength(120) name: string;
  @IsString() @Matches(/^[a-z0-9-]+$/) alias: string;
  @IsString() @MaxLength(40) code: string;
  @IsIn(['CENTRAL_GOVERNMENT', 'GOVERNMENT', 'PRIVATE']) orgType: string;
  @IsString() @MaxLength(120) domain: string;
  @IsOptional() @IsUUID() parentOrganizationId?: string;
}

class UpdateOrganizationDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(40) code?: string;
  @IsOptional() @IsIn(['CENTRAL_GOVERNMENT', 'GOVERNMENT', 'PRIVATE']) orgType?: string;
  @IsOptional() @IsUUID() parentOrganizationId?: string | null;
}

class CreateDepartmentDto {
  @IsString() @MaxLength(120) name: string;
  @IsString() @MaxLength(40) departmentCode: string;
}

class CreatePositionDto {
  @IsString() @MaxLength(120) name: string;
  @IsUUID() parentGroupId: string;
  @IsString() @MaxLength(40) positionCode: string;
  @IsString() @MaxLength(120) positionName: string;
  @IsIn(['LOW', 'HIGH']) riskLevel: 'LOW' | 'HIGH';
}

class UpdatePositionDto {
  @IsUUID() organizationId: string;
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(120) positionName?: string;
  @IsOptional() @IsIn(['LOW', 'HIGH']) riskLevel?: 'LOW' | 'HIGH';
}

class DutyDto {
  @IsUUID() organizationId: string;
  @IsString() roleName: string;
}

@ApiTags('organizations')
@ApiBearerAuth()
@Controller()
export class OrganizationsController {
  constructor(
    private readonly orgs: OrganizationsService,
    private readonly authz: AuthorizationService,
  ) {}

  @Get('organizations')
  list() {
    return this.orgs.list();
  }

  @Post('organizations')
  create(@CurrentUser() user: AccessClaims, @Body() dto: CreateOrganizationDto) {
    return this.orgs.create(user.sub, dto);
  }

  @Patch('organizations/:id')
  update(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: UpdateOrganizationDto) {
    return this.orgs.update(user.sub, id, dto);
  }

  @Get('organizations/:id/departments')
  departments(@Param('id') id: string) {
    return this.orgs.departments(id);
  }

  @Post('organizations/:id/departments')
  createDepartment(
    @CurrentUser() user: AccessClaims,
    @Param('id') id: string,
    @Body() dto: CreateDepartmentDto,
  ) {
    return this.orgs.createDepartment(user.sub, id, dto);
  }

  @Get('organizations/:id/positions')
  positions(@Param('id') id: string) {
    return this.orgs.positions(id);
  }

  @Post('organizations/:id/positions')
  createPosition(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: CreatePositionDto) {
    return this.orgs.createPosition(user.sub, id, dto);
  }

  @Patch('positions/:id')
  updatePosition(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: UpdatePositionDto) {
    return this.orgs.updatePosition(user.sub, dto.organizationId, id, dto);
  }

  @Get('positions/:id/duties')
  duties(@Param('id') id: string, @Query('organizationId') organizationId: string) {
    return this.orgs.duties(organizationId, id);
  }

  @Post('positions/:id/duties')
  addDuty(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: DutyDto) {
    return this.orgs.addDuty(user.sub, dto.organizationId, id, dto.roleName);
  }

  @Delete('positions/:id/duties/:roleName')
  removeDuty(
    @CurrentUser() user: AccessClaims,
    @Param('id') id: string,
    @Param('roleName') roleName: string,
    @Query('organizationId') organizationId: string,
  ) {
    return this.orgs.removeDuty(user.sub, organizationId, id, roleName);
  }

  @Get('roles')
  roles() {
    return this.orgs.roles();
  }

  @Get('authorization/effective-permissions')
  async effective(
    @CurrentUser() user: AccessClaims,
    @Query('organizationId') organizationId: string,
  ) {
    const decision = await this.authz.authorize({
      userId: user.sub,
      organizationId,
      permission: 'budget:draft:read',
      fresh: true,
    });
    return {
      organizationId,
      decision: decision.decision,
      reason: decision.reason,
      permissions: decision.permissions,
    };
  }

  @Get('permission-matrix')
  matrix() {
    return this.orgs.matrix();
  }
}
