import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtOrApiKeyGuard } from '../api-keys/jwt-or-api-key.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { ApiOrg } from '../common/decorators/org.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CreateSessionDto } from './dto/session.dto';
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
  constructor(private readonly whatsapp: WhatsappService) {}

  private orgOf(organizationId: string | undefined): string {
    if (!organizationId)
      throw new BadRequestException('User has no organization');
    return organizationId;
  }

  @Get()
  list(@ApiOrg() org: string | undefined) {
    return this.whatsapp.list(this.orgOf(org));
  }

  @OrgRoles('ADMIN')
  @Post()
  create(@ApiOrg() org: string | undefined, @Body() dto: CreateSessionDto) {
    return this.whatsapp.create(this.orgOf(org), dto.label);
  }

  @Get(':id')
  get(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.whatsapp.get(this.orgOf(org), id);
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

  @Post(':id/test-message')
  testMessage(
    @ApiOrg() org: string | undefined,
    @Param('id') id: string,
    @Body() dto: TestMessageDto,
  ) {
    return this.whatsapp.sendTest(this.orgOf(org), id, dto.to, dto.text);
  }

  @OrgRoles('ADMIN')
  @Delete(':id')
  remove(@ApiOrg() org: string | undefined, @Param('id') id: string) {
    return this.whatsapp.remove(this.orgOf(org), id);
  }
}
