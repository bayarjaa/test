import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessClaims } from '../auth/jwt';
import { AccessService } from './access.service';

class CreateAccessRequestDto {
  @IsUUID() organizationId: string;
  @IsUUID() positionGroupId: string;
  @IsUUID() targetKeycloakId: string;
  @IsOptional() @IsISO8601() expiresAt?: string;
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

class DecisionDto {
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

@ApiTags('access-requests')
@ApiBearerAuth()
@Controller('access-requests')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Get()
  list(@Query('organizationId') organizationId?: string) {
    return this.access.list(organizationId);
  }

  @Post()
  create(@CurrentUser() user: AccessClaims, @Body() dto: CreateAccessRequestDto) {
    return this.access.create(user.sub, dto);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.access.approve(user.sub, id, dto.comment);
  }

  @Post(':id/reject')
  reject(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.access.reject(user.sub, id, dto.comment);
  }
}
