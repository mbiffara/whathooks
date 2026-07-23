import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssignableRole } from './dto/organization.dto';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Organizations the user belongs to (for the org switcher). */
  async listMine(userId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      id: m.organizationId,
      name: m.organization.name,
      role: m.role,
      joinedAt: m.createdAt,
    }));
  }

  async members(organizationId: string) {
    const memberships = await this.prisma.membership.findMany({
      where: { organizationId },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({
      userId: m.userId,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      sessionIds: m.sessionIds,
      joinedAt: m.createdAt,
    }));
  }

  /**
   * Scope a MEMBER to specific sessions (empty = all). Owners/admins are
   * never restricted, so setting a list on them is rejected.
   */
  async updateMemberSessions(
    organizationId: string,
    userId: string,
    sessionIds: string[],
  ) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership) throw new NotFoundException('Member not found');
    if (membership.role !== 'MEMBER' && sessionIds.length > 0) {
      throw new BadRequestException(
        'Session restrictions only apply to members',
      );
    }
    if (sessionIds.length > 0) {
      const owned = await this.prisma.waSession.count({
        where: { id: { in: sessionIds }, organizationId },
      });
      if (owned !== sessionIds.length) {
        throw new BadRequestException('Unknown session');
      }
    }
    await this.prisma.membership.update({
      where: { userId_organizationId: { userId, organizationId } },
      data: { sessionIds },
    });
    return { ok: true, sessionIds };
  }

  rename(organizationId: string, name: string) {
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: { name },
      select: { id: true, name: true },
    });
  }

  async remove(organizationId: string) {
    // Live Baileys sockets are held by the ConnectionManager; deleting the org
    // under them would orphan the connections. Require explicit cleanup first.
    const sessions = await this.prisma.waSession.count({
      where: { organizationId },
    });
    if (sessions > 0) {
      throw new BadRequestException(
        'Delete the organization’s WhatsApp sessions first',
      );
    }
    await this.prisma.organization.delete({ where: { id: organizationId } });
    return { ok: true };
  }

  async updateMemberRole(
    organizationId: string,
    actorUserId: string,
    targetUserId: string,
    role: AssignableRole,
  ) {
    if (actorUserId === targetUserId) {
      throw new BadRequestException(
        'You cannot change your own role; transfer ownership instead',
      );
    }
    const target = await this.requireMembership(organizationId, targetUserId);
    if (target.role === 'OWNER') {
      throw new BadRequestException(
        'The owner’s role can only change via ownership transfer',
      );
    }
    const updated = await this.prisma.membership.update({
      where: { id: target.id },
      data: { role },
      include: { user: true },
    });
    return {
      userId: updated.userId,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      joinedAt: updated.createdAt,
    };
  }

  /** Remove a member. Self-removal = leaving; otherwise the actor must be OWNER. */
  async removeMember(
    organizationId: string,
    actor: { userId: string; orgRole?: string },
    targetUserId: string,
  ) {
    const leaving = actor.userId === targetUserId;
    if (!leaving && actor.orgRole !== 'OWNER') {
      throw new ForbiddenException('Only the owner can remove members');
    }
    const target = await this.requireMembership(organizationId, targetUserId);

    if (target.role === 'OWNER') {
      const owners = await this.prisma.membership.count({
        where: { organizationId, role: 'OWNER' },
      });
      if (owners <= 1) {
        throw new BadRequestException(
          'Transfer ownership before leaving: an organization needs an owner',
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.membership.delete({ where: { id: target.id } });
      // Repoint the removed user's active org so their next request/login
      // lands somewhere they still belong.
      const user = await tx.user.findUnique({ where: { id: targetUserId } });
      if (user?.organizationId === organizationId) {
        const next = await tx.membership.findFirst({
          where: { userId: targetUserId },
          orderBy: { createdAt: 'asc' },
        });
        await tx.user.update({
          where: { id: targetUserId },
          data: { organizationId: next?.organizationId ?? null },
        });
      }
    });
    return { ok: true };
  }

  async transferOwnership(
    organizationId: string,
    fromUserId: string,
    toUserId: string,
  ) {
    if (fromUserId === toUserId) {
      throw new BadRequestException('You already own this organization');
    }
    const from = await this.requireMembership(organizationId, fromUserId);
    if (from.role !== 'OWNER') {
      throw new ForbiddenException('Only the owner can transfer ownership');
    }
    const to = await this.requireMembership(organizationId, toUserId);

    await this.prisma.$transaction([
      this.prisma.membership.update({
        where: { id: to.id },
        data: { role: 'OWNER' },
      }),
      this.prisma.membership.update({
        where: { id: from.id },
        data: { role: 'ADMIN' },
      }),
    ]);
    return { ok: true };
  }

  private async requireMembership(organizationId: string, userId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership) {
      throw new NotFoundException('Member not found in this organization');
    }
    return membership;
  }
}
