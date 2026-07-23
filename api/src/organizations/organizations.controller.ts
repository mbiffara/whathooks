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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { OrgRolesGuard } from '../auth/org-roles.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import {
  InviteMemberDto,
  TransferOwnershipDto,
  UpdateMemberRoleDto,
  UpdateMemberSessionsDto,
  UpdateOrganizationDto,
} from './dto/organization.dto';
import { InvitationsService } from './invitations.service';
import { OrganizationsService } from './organizations.service';

@UseGuards(JwtAuthGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly invitations: InvitationsService,
  ) {}

  private orgOf(user: AuthUser): string {
    if (!user.organizationId)
      throw new BadRequestException('User has no organization');
    return user.organizationId;
  }

  /** Org switcher source — needs no active org, only a valid JWT. */
  @Get()
  listMine(@CurrentUser() user: AuthUser) {
    return this.organizations.listMine(user.userId);
  }

  @UseGuards(OrgRolesGuard)
  @Get('members')
  members(@CurrentUser() user: AuthUser) {
    return this.organizations.members(this.orgOf(user));
  }

  @UseGuards(OrgRolesGuard)
  @OrgRoles('OWNER')
  @Patch()
  rename(@CurrentUser() user: AuthUser, @Body() dto: UpdateOrganizationDto) {
    return this.organizations.rename(this.orgOf(user), dto.name);
  }

  @UseGuards(OrgRolesGuard)
  @OrgRoles('OWNER')
  @Delete()
  remove(@CurrentUser() user: AuthUser) {
    return this.organizations.remove(this.orgOf(user));
  }

  @UseGuards(OrgRolesGuard)
  @OrgRoles('OWNER')
  @Patch('members/:userId')
  updateMemberRole(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberRoleDto,
  ) {
    return this.organizations.updateMemberRole(
      this.orgOf(user),
      user.userId,
      userId,
      dto.role,
    );
  }

  // Any member may call this on themselves (leave); removing someone else
  // requires OWNER — enforced in the service using the guard-attached orgRole.
  @UseGuards(OrgRolesGuard)
  @Delete('members/:userId')
  removeMember(@CurrentUser() user: AuthUser, @Param('userId') userId: string) {
    return this.organizations.removeMember(this.orgOf(user), user, userId);
  }

  // Owners and admins can scope a MEMBER to specific sessions.
  @UseGuards(OrgRolesGuard)
  @OrgRoles('ADMIN')
  @Patch('members/:userId/sessions')
  updateMemberSessions(
    @CurrentUser() user: AuthUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateMemberSessionsDto,
  ) {
    return this.organizations.updateMemberSessions(
      this.orgOf(user),
      userId,
      dto.sessionIds,
    );
  }

  @UseGuards(OrgRolesGuard)
  @OrgRoles('OWNER')
  @Post('transfer-ownership')
  transferOwnership(
    @CurrentUser() user: AuthUser,
    @Body() dto: TransferOwnershipDto,
  ) {
    return this.organizations.transferOwnership(
      this.orgOf(user),
      user.userId,
      dto.userId,
    );
  }

  @UseGuards(OrgRolesGuard)
  @OrgRoles('ADMIN')
  @Get('invitations')
  listInvitations(@CurrentUser() user: AuthUser) {
    return this.invitations.list(this.orgOf(user));
  }

  @UseGuards(OrgRolesGuard)
  @OrgRoles('ADMIN')
  @Post('invitations')
  invite(@CurrentUser() user: AuthUser, @Body() dto: InviteMemberDto) {
    return this.invitations.create(
      this.orgOf(user),
      user.userId,
      dto.email,
      dto.role,
    );
  }

  @UseGuards(OrgRolesGuard)
  @OrgRoles('ADMIN')
  @Post('invitations/:id/regenerate')
  regenerateInvitation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invitations.regenerate(this.orgOf(user), id);
  }

  @UseGuards(OrgRolesGuard)
  @OrgRoles('ADMIN')
  @Delete('invitations/:id')
  revokeInvitation(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.invitations.revoke(this.orgOf(user), id);
  }
}
