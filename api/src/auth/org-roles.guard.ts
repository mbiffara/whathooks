import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrgRole } from '@prisma/client';
import { AuthUser } from '../common/decorators/current-user.decorator';
import { ORG_ROLES_KEY } from '../common/decorators/org-roles.decorator';
import { PrismaService } from '../prisma/prisma.service';

const RANK: Record<OrgRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

/**
 * Authorizes against the user's Membership in their active organization.
 * The role is read from the DB on every request (never from the JWT), so
 * removals and demotions take effect immediately. `@OrgRoles(...)` sets the
 * minimum role; without it any member passes. Platform ADMINs bypass.
 */
@Injectable()
export class OrgRolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ apiKeyId?: string; user?: AuthUser }>();
    // API-key requests (JwtOrApiKeyGuard) carry no user; the key itself is an
    // org-scoped machine credential with full access to its organization.
    if (req.apiKeyId) return true;
    const user = req.user;
    if (!user) throw new ForbiddenException();
    if (user.role === 'ADMIN') return true;
    if (!user.organizationId) {
      throw new BadRequestException('User has no organization');
    }

    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: user.userId,
          organizationId: user.organizationId,
        },
      },
    });
    if (!membership) {
      throw new ForbiddenException('Not a member of this organization');
    }
    user.orgRole = membership.role;

    const required = this.reflector.getAllAndOverride<OrgRole[]>(
      ORG_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const minRank = Math.min(...required.map((r) => RANK[r]));
    if (RANK[membership.role] < minRank) {
      throw new ForbiddenException('Insufficient role in organization');
    }
    return true;
  }
}
