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
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
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
 * Flows CRUD — org admins/owners manage their org's automation (platform
 * ADMINs bypass via OrgRolesGuard, so support mode keeps working). Flow
 * creation is plan-capped in the service.
 */
class SimulateMessageDto {
  @IsIn(['contact', 'business'])
  from!: 'contact' | 'business';

  @IsString()
  @Length(1, 2000)
  text!: string;
}

class SimulateDto {
  /** The pretend conversation so far; the last turn is the one delivered. */
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => SimulateMessageDto)
  messages!: SimulateMessageDto[];
}

@UseGuards(JwtAuthGuard, OrgRolesGuard)
@OrgRoles('ADMIN')
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

  /** Dry-run the flow against a made-up message. Nothing is sent or written. */
  @Post(':id/simulate')
  simulate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SimulateDto,
  ) {
    return this.flows.simulate(this.orgOf(user), id, body.messages);
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
