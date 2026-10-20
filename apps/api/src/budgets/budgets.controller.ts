import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AccessClaims } from '../auth/jwt';
import { BudgetsService } from './budgets.service';

class BudgetLineDto {
  @IsString() @MaxLength(200) description: string;
  @IsNumber() @Min(0) amount: number;
}

class CreateBudgetDto {
  @IsUUID() organizationId: string;
  @IsString() @MaxLength(200) title: string;
  @IsInt() @Min(2000) @Max(2100) fiscalYear: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => BudgetLineDto) lines: BudgetLineDto[];
}

class UpdateBudgetDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsInt() @Min(2000) @Max(2100) fiscalYear?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BudgetLineDto) lines?: BudgetLineDto[];
}

class CommentDto {
  @IsOptional() @IsString() @MaxLength(500) comment?: string;
}

@ApiTags('budgets')
@ApiBearerAuth()
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  list(@CurrentUser() user: AccessClaims, @Query('organizationId') organizationId: string) {
    return this.budgets.list(user.sub, organizationId);
  }

  @Get(':id')
  get(@CurrentUser() user: AccessClaims, @Param('id') id: string) {
    return this.budgets.get(user.sub, id);
  }

  @Post()
  create(@CurrentUser() user: AccessClaims, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(user.sub, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    return this.budgets.update(user.sub, id, dto);
  }

  @Post(':id/submit')
  submit(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.budgets.submit(user.sub, id, dto.comment);
  }

  @Post(':id/review')
  review(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.budgets.review(user.sub, id, dto.comment);
  }

  @Post(':id/return')
  returnToDraft(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.budgets.returnToDraft(user.sub, id, dto.comment);
  }

  @Post(':id/approve')
  approve(@CurrentUser() user: AccessClaims, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.budgets.approve(user.sub, id, dto.comment);
  }
}
