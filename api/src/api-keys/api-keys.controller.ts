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
import {
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { ApiKeysService } from './api-keys.service';
import { API_KEY_SCOPES, type ApiKeyScope } from './scopes';

class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /**
   * What the key may do. Omitted means no scopes, i.e. a key that can
   * authenticate but do nothing — deliberately the safe default for anything
   * created without saying, rather than inheriting full access.
   */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: ApiKeyScope[];

  /** Sessions the key may act on; omitted or empty = all of them. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  sessionIds?: string[];
}

@UseGuards(JwtAuthGuard, OrgRolesGuard)
@OrgRoles('ADMIN')
@Controller('api-keys')
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeysService) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.apiKeys.list(this.orgOf(user));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateApiKeyDto) {
    return this.apiKeys.create(this.orgOf(user), dto.name, {
      scopes: dto.scopes ?? [],
      sessionIds: dto.sessionIds ?? [],
    });
  }

  /** The catalogue, so the UI does not hardcode a copy that can drift. */
  @Get('scopes')
  availableScopes() {
    return { scopes: API_KEY_SCOPES };
  }

  /** Permanently remove a revoked key. Live keys must be revoked first. */
  @Delete(':id/permanent')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.apiKeys.remove(this.orgOf(user), id);
  }

  @Delete(':id')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.apiKeys.revoke(this.orgOf(user), id);
  }
}
