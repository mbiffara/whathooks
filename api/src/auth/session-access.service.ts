import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-member session access. A MEMBER whose membership carries a non-empty
 * `sessionIds` list only sees those sessions; owners, org admins, platform
 * ADMINs, and API-key requests (no user) are never restricted.
 */
@Injectable()
export class SessionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** null = unrestricted; otherwise the allow-list of session ids. */
  async restrictedSessionIds(
    user: AuthUser | undefined,
    organizationId: string,
  ): Promise<string[] | null> {
    if (!user) return null; // API-key request — org-level credential
    if (user.role === 'ADMIN') return null; // platform admin / support mode
    const membership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: user.userId, organizationId },
      },
      select: { role: true, sessionIds: true },
    });
    if (
      !membership ||
      (membership.role !== 'MEMBER' && membership.role !== 'OPERATOR')
    ) {
      return null;
    }
    return membership.sessionIds.length ? membership.sessionIds : null;
  }

  /** 404 (not 403) so restricted members can't probe session existence. */
  async assertSessionAllowed(
    user: AuthUser | undefined,
    organizationId: string,
    sessionId: string,
  ): Promise<void> {
    const allowed = await this.restrictedSessionIds(user, organizationId);
    if (allowed && !allowed.includes(sessionId)) {
      throw new NotFoundException('Session not found');
    }
  }
}
