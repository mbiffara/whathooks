import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { InvitationsService } from './invitations.service';

// Token-addressed invitation routes. The token itself is the credential
// (capability link), so lookup needs no auth; accepting needs a signed-in
// user to attach the membership to.
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get(':token')
  lookup(@Param('token') token: string) {
    return this.invitations.lookup(token);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':token/accept')
  accept(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    return this.invitations.accept(token, user.userId);
  }
}
