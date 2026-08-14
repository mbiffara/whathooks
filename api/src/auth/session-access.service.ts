import { Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../common/decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-member and per-key session access.
 *
 * A MEMBER whose membership carries a non-empty `sessionIds` list only sees
 * those sessions; owners, org admins and platform ADMINs are never
 * restricted. An API key may carry its own allow-list, which is why the
 * caller passes one in: the service cannot see the request, and inventing a
 * second restriction path would mean every consumer had to remember both.
 */
@Injectable()
export class SessionAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** null = unrestricted; otherwise the allow-list of session ids. */
  async restrictedSessionIds(
    user: AuthUser | undefined,
    organizationId: string,
    /** The API key's allow-list, when the request came from one. */
    keySessionIds?: string[],
  ): Promise<string[] | null> {
    // An API-key request has no user. Unscoped keys stay unrestricted, which
    // is what every key was before scoping existed.
    if (!user) return keySessionIds?.length ? keySessionIds : null;
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
    keySessionIds?: string[],
  ): Promise<void> {
    const allowed = await this.restrictedSessionIds(
      user,
      organizationId,
      keySessionIds,
    );
    if (allowed && !allowed.includes(sessionId)) {
      throw new NotFoundException('Session not found');
    }
  }
}
