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
import { JwtOrApiKeyGuard } from '../api-keys/jwt-or-api-key.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { SessionAccessService } from '../auth/session-access.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { ApiOrg } from '../common/decorators/org.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CreateSessionDto, UpdateSessionDto } from './dto/session.dto';
import { WhatsappService } from './whatsapp.service';

class TestMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  to!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}

/**
 * Session management for both the dashboard (JWT + org roles) and
 * programmatic callers (API key, full org access) — the latter so products
 * can create sessions and embed the pairing QR in their own UI.
 */
@UseGuards(JwtOrApiKeyGuard, OrgRolesGuard)
@Controller('sessions')
export class SessionsController {
  constructor(
    private readonly whatsapp: WhatsappService,
    private readonly access: SessionAccessService,
  ) {}

  private orgOf(organizationId: string | undefined): string {
    if (!organizationId)
      throw new BadRequestException('User has no organization');
    return organizationId;
  }

  @Get()
  async list(
    @ApiOrg() org: string | undefined,
    @CurrentUser() user?: AuthUser,
  ) {
    const organizationId = this.orgOf(org);
    const allowed = await this.access.restrictedSessionIds(
      user,
      organizationId,
    );
    return this.whatsapp.list(organizationId, allowed);
  }

  @OrgRoles('ADMIN')
  @Post()
  create(@ApiOrg() org: string | undefined, @Body() dto: CreateSessionDto) {
    return this.whatsapp.create(this.orgOf(org), dto.label);
  }

  @OrgRoles('MEMBER') // detail is management; operators only need the list
  @Get(':id')
  async get(
    @ApiOrg() org: string | undefined,
    @Param('id') id: string,
    @CurrentUser() user?: AuthUser,
  ) {
    const organizationId = this.orgOf(org);
    await this.access.assertSessionAllowed(user, organizationId, id);
    return this.whatsapp.get(organizationId, id);
  }

  @OrgRoles('ADMIN')
  @Patch(':id')
  update(
    @ApiOrg() org: string | undefined,
    @Param('id') id: string,
    @Body() dto: UpdateSessionDto,
  ) {
    return this.whatsapp.update(this.orgOf(org), id, dto);
  }

  @OrgRoles('ADMIN')
  @Post(':id/share')
  share(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.whatsapp.createShareLink(this.orgOf(org), id);
  }

  @OrgRoles('ADMIN')
  @Delete(':id/share')
  unshare(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.whatsapp.revokeShareLink(this.orgOf(org), id);
  }

  @OrgRoles('ADMIN')
  @Post(':id/connect')
  connect(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.whatsapp.connect(this.orgOf(org), id);
  }

  @OrgRoles('ADMIN')
  @Post(':id/logout')
  logout(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.whatsapp.logout(this.orgOf(org), id);
  }

  @OrgRoles('MEMBER')
  @Post(':id/test-message')
  async testMessage(
    @ApiOrg() org: string | undefined,
    @Param('id') id: string,
    @Body() dto: TestMessageDto,
    @CurrentUser() user?: AuthUser,
  ) {
    const organizationId = this.orgOf(org);
    await this.access.assertSessionAllowed(user, organizationId, id);
    return this.whatsapp.sendTest(organizationId, id, dto.to, dto.text);
  }

  @OrgRoles('ADMIN')
  @Delete(':id')
  remove(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.whatsapp.remove(this.orgOf(org), id);
  }
}
