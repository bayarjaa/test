import { Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessClaims } from '../auth/jwt';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(@Query('search') search = '') {
    return this.users.search(search);
  }

  @Get(':id/positions')
  positions(@Param('id') id: string, @Query('organizationId') organizationId?: string) {
    return this.users.positions(id, organizationId);
  }

  @Delete(':id/positions/:positionId')
  revoke(
    @CurrentUser() user: AccessClaims,
    @Param('id') id: string,
    @Param('positionId') positionId: string,
    @Query('organizationId') organizationId: string,
  ) {
    return this.users.revoke(user.sub, id, organizationId, positionId);
  }
}
