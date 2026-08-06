import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import { JwtOrApiKeyGuard } from '../api-keys/jwt-or-api-key.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { ApiOrg } from '../common/decorators/org.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { MirrorService } from './mirror.service';

const PHONE_RULE = /^\d{7,15}$/;
const PHONE_MSG = 'phoneNumber must be digits with country code, no +';

class CreateAgentDto {
  @IsString()
  name!: string;

  @Matches(PHONE_RULE, { message: PHONE_MSG })
  phoneNumber!: string;

  // Optional dashboard-account link; null/absent = unlinked.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  userId?: string | null;
}

class UpdateAgentDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Matches(PHONE_RULE, { message: PHONE_MSG })
  phoneNumber?: string;

  // null clears the link.
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  userId?: string | null;
}

class CreateLinkDto {
  @IsString()
  sessionId!: string;

  @IsString()
  humanAgentId!: string;

  // Mirror groups are named "<groupPrefix> #<seq>"; default "🔒 Lead".
  @IsOptional()
  @IsString()
  @Length(1, 40)
  groupPrefix?: string;

  // Prefix relayed messages with the lead's display name (default true).
  @IsOptional()
  @IsBoolean()
  showLeadName?: boolean;
}

class UpdateLinkDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsBoolean()
  showLeadName?: boolean;
}

@UseGuards(JwtOrApiKeyGuard, OrgRolesGuard)
@OrgRoles('MEMBER') // management surface — hidden from OPERATOR
@Controller()
export class MirrorController {
  constructor(private readonly mirror: MirrorService) {}

  private orgOf(organizationId: string | undefined): string {
    if (!organizationId)
      throw new BadRequestException('User has no organization');
    return organizationId;
  }

  // ---- human agents ----

  @Get('human-agents')
  listAgents(@ApiOrg() org: string | undefined) {
    return this.mirror.listAgents(this.orgOf(org));
  }

  @OrgRoles('ADMIN')
  @Post('human-agents')
  createAgent(@ApiOrg() org: string | undefined, @Body() dto: CreateAgentDto) {
    return this.mirror.createAgent(this.orgOf(org), dto);
  }

  @OrgRoles('ADMIN')
  @Patch('human-agents/:id')
  updateAgent(
    @ApiOrg() org: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ) {
    return this.mirror.updateAgent(this.orgOf(org), id, dto);
  }

  @OrgRoles('ADMIN')
  @Delete('human-agents/:id')
  deleteAgent(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.mirror.deleteAgent(this.orgOf(org), id);
  }

  // ---- mirror links ----

  @Get('mirror-links')
  listLinks(@ApiOrg() org: string | undefined) {
    return this.mirror.listLinks(this.orgOf(org));
  }

  @OrgRoles('ADMIN')
  @Post('mirror-links')
  createLink(@ApiOrg() org: string | undefined, @Body() dto: CreateLinkDto) {
    return this.mirror.createLink(this.orgOf(org), dto);
  }

  @OrgRoles('ADMIN')
  @Patch('mirror-links/:id')
  updateLink(
    @ApiOrg() org: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateLinkDto,
  ) {
    return this.mirror.updateLink(this.orgOf(org), id, dto);
  }

  @OrgRoles('ADMIN')
  @Delete('mirror-links/:id')
  deleteLink(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.mirror.deleteLink(this.orgOf(org), id);
  }

  @Get('mirror-links/:id/threads')
  listThreads(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.mirror.listThreads(this.orgOf(org), id);
  }
}
