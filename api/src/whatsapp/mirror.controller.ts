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
import { IsBoolean, IsOptional, IsString, Matches } from 'class-validator';
import { JwtOrApiKeyGuard } from '../api-keys/jwt-or-api-key.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { ApiOrg } from '../common/decorators/org.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { MirrorService } from './mirror.service';

const PHONE_RULE = /^\d{7,15}$/;
const PHONE_MSG = 'phoneNumber must be digits with country code, no +';

class CreateRepDto {
  @IsString()
  name!: string;

  @Matches(PHONE_RULE, { message: PHONE_MSG })
  phoneNumber!: string;
}

class UpdateRepDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @Matches(PHONE_RULE, { message: PHONE_MSG })
  phoneNumber?: string;
}

class CreateLinkDto {
  @IsString()
  sessionId!: string;

  @IsString()
  repId!: string;
}

class UpdateLinkDto {
  @IsBoolean()
  enabled!: boolean;
}

@UseGuards(JwtOrApiKeyGuard, OrgRolesGuard)
@Controller()
export class MirrorController {
  constructor(private readonly mirror: MirrorService) {}

  private orgOf(organizationId: string | undefined): string {
    if (!organizationId)
      throw new BadRequestException('User has no organization');
    return organizationId;
  }

  // ---- sales reps ----

  @Get('sales-reps')
  listReps(@ApiOrg() org: string | undefined) {
    return this.mirror.listReps(this.orgOf(org));
  }

  @OrgRoles('ADMIN')
  @Post('sales-reps')
  createRep(@ApiOrg() org: string | undefined, @Body() dto: CreateRepDto) {
    return this.mirror.createRep(this.orgOf(org), dto);
  }

  @OrgRoles('ADMIN')
  @Patch('sales-reps/:id')
  updateRep(
    @ApiOrg() org: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateRepDto,
  ) {
    return this.mirror.updateRep(this.orgOf(org), id, dto);
  }

  @OrgRoles('ADMIN')
  @Delete('sales-reps/:id')
  deleteRep(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.mirror.deleteRep(this.orgOf(org), id);
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
    return this.mirror.updateLink(this.orgOf(org), id, dto.enabled);
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
