import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { FLOW_TEMPLATES } from './flow-templates';
import type { FlowTemplate } from './flow-templates';
import { FlowsService } from './flows.service';

class CreateFlowDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsIn(FLOW_TEMPLATES)
  template?: FlowTemplate;
}

class AssignSessionDto {
  // null clears the assignment (flow becomes a draft and is disabled).
  @ValidateIf((_, v) => v !== null)
  @IsString()
  sessionId!: string | null;

  // Required to steal a session already attached to another flow.
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

class SaveGraphDto {
  @IsDefined()
  graph!: unknown;
}

class UpdateFlowDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

/**
 * Flows CRUD — platform-admin experiment: requires the platform ADMIN role
 * (like the admin console), but operates on the admin's ACTIVE org, so
 * support-mode org switching works.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@Controller('flows')
export class FlowsController {
  constructor(private readonly flows: FlowsService) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.flows.list(this.orgOf(user));
  }

  /** Selectable entities for the editor's node config forms. */
  @Get('references')
  references(@CurrentUser() user: AuthUser) {
    return this.flows.references(this.orgOf(user));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFlowDto) {
    return this.flows.create(this.orgOf(user), dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.flows.get(this.orgOf(user), id);
  }

  @Post(':id/assign')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: AssignSessionDto,
  ) {
    return this.flows.assignSession(
      this.orgOf(user),
      id,
      dto.sessionId,
      dto.force ?? false,
    );
  }

  @Get(':id/runs')
  runs(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.flows.listRuns(this.orgOf(user), id);
  }

  @Put(':id/graph')
  saveGraph(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: SaveGraphDto,
  ) {
    return this.flows.saveGraph(this.orgOf(user), id, dto.graph);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFlowDto,
  ) {
    return this.flows.update(this.orgOf(user), id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.flows.remove(this.orgOf(user), id);
  }
}
