import {
  Body,
  Controller,
  Delete,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtOrApiKeyGuard } from '../api-keys/jwt-or-api-key.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { ApiOrg } from '../common/decorators/org.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { InstagramService } from './instagram.service';

class ConnectInstagramDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;
}

/**
 * Connecting Instagram accounts. Admin-only: it spends money (a seat must be
 * paid for first) and changes what the org is connected to.
 */
@UseGuards(JwtOrApiKeyGuard, OrgRolesGuard)
@OrgRoles('ADMIN')
@Controller('instagram')
export class InstagramController {
  constructor(private readonly instagram: InstagramService) {}

  /** Start the OAuth flow. Requires a paid, unused seat. */
  @Post('connect')
  connect(@ApiOrg() organizationId: string, @Body() dto: ConnectInstagramDto) {
    return this.instagram.beginConnect(organizationId, dto.label);
  }

  /**
   * Match newly authorised accounts onto pending sessions. Called when the
   * customer returns from Zernio's redirect — the OAuth callback lands on
   * Zernio, so nothing of ours observes the completion directly.
   */
  @Post('reconcile')
  reconcile(@ApiOrg() organizationId: string) {
    return this.instagram.reconcile(organizationId);
  }

  @Delete(':id')
  async disconnect(
    @ApiOrg() organizationId: string,
    @Param('id') id: string,
  ): Promise<{ ok: true }> {
    await this.instagram.disconnect(organizationId, id);
    return { ok: true };
  }
}
