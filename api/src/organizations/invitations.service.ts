import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Invitation } from '@prisma/client';
import { randomBytes } from 'crypto';
import { hashToken } from '../api-keys/api-keys.service';
import { AuthService } from '../auth/auth.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AssignableRole } from './dto/organization.dto';

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';

function statusOf(invite: Invitation): InvitationStatus {
  if (invite.acceptedAt) return 'ACCEPTED';
  if (invite.revokedAt) return 'REVOKED';
  if (invite.expiresAt < new Date()) return 'EXPIRED';
  return 'PENDING';
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly auth: AuthService,
  ) {}

  private publicInvite(invite: Invitation) {
    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      status: statusOf(invite),
      expiresAt: invite.expiresAt,
      createdAt: invite.createdAt,
    };
  }

  private inviteUrl(rawToken: string): string {
    // WEB_ORIGIN may be a comma-separated CORS list in prod — link to the
    // first entry (same convention as billing.service.webBase).
    const origin = this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:3000')
      .split(',')[0]
      .trim();
    return `${origin}/invite/${rawToken}`;
  }

  private expiry(): Date {
    const days = Number(this.config.get('INVITE_TTL_DAYS', '7')) || 7;
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  async create(
    organizationId: string,
    invitedById: string,
    email: string,
    role: AssignableRole,
  ) {
    const normalized = email.toLowerCase();

    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalized },
    });
    if (existingUser) {
      const membership = await this.prisma.membership.findUnique({
        where: {
          userId_organizationId: { userId: existingUser.id, organizationId },
        },
      });
      if (membership) {
        throw new ConflictException(
          'That email already belongs to a member of this organization',
        );
      }
    }

    // A new invite supersedes any pending one for the same email.
    await this.prisma.invitation.updateMany({
      where: {
        organizationId,
        email: normalized,
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    const rawToken = randomBytes(24).toString('base64url');
    const invite = await this.prisma.invitation.create({
      data: {
        organizationId,
        email: normalized,
        role,
        tokenHash: hashToken(rawToken),
        invitedById,
        expiresAt: this.expiry(),
      },
    });

    const emailSent = await this.sendMail(invite, rawToken);
    return {
      invitation: this.publicInvite(invite),
      inviteUrl: this.inviteUrl(rawToken),
      emailSent,
    };
  }

  async list(organizationId: string) {
    const invites = await this.prisma.invitation.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return invites.map((i) => this.publicInvite(i));
  }

  async revoke(organizationId: string, id: string) {
    const invite = await this.require(organizationId, id);
    if (statusOf(invite) !== 'PENDING') {
      throw new BadRequestException('Invitation is no longer pending');
    }
    await this.prisma.invitation.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /** Rotate the token (the raw link is only shown once) and extend expiry. */
  async regenerate(organizationId: string, id: string) {
    const invite = await this.require(organizationId, id);
    const status = statusOf(invite);
    if (status === 'ACCEPTED' || status === 'REVOKED') {
      throw new BadRequestException(
        `Invitation was already ${status.toLowerCase()}`,
      );
    }
    const rawToken = randomBytes(24).toString('base64url');
    const updated = await this.prisma.invitation.update({
      where: { id },
      data: { tokenHash: hashToken(rawToken), expiresAt: this.expiry() },
    });
    const emailSent = await this.sendMail(updated, rawToken);
    return {
      invitation: this.publicInvite(updated),
      inviteUrl: this.inviteUrl(rawToken),
      emailSent,
    };
  }

  /** Public lookup for the accept page (token is the credential). */
  async lookup(rawToken: string) {
    const invite = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { organization: true, invitedBy: true },
    });
    if (!invite) throw new NotFoundException('Invitation not found');
    return {
      organizationName: invite.organization.name,
      email: invite.email,
      role: invite.role,
      inviterName: invite.invitedBy?.name ?? null,
      status: statusOf(invite),
      expiresAt: invite.expiresAt,
    };
  }

  /**
   * Join the invite's organization as the signed-in user. Idempotent for
   * existing members (keeps their current role). Returns a fresh auth
   * response with the joined org active.
   */
  async accept(rawToken: string, userId: string) {
    const invite = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (!invite || statusOf(invite) !== 'PENDING') {
      throw new BadRequestException('Invitation is invalid or has expired');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.membership.upsert({
        where: {
          userId_organizationId: {
            userId,
            organizationId: invite.organizationId,
          },
        },
        create: {
          userId,
          organizationId: invite.organizationId,
          role: invite.role,
        },
        update: {}, // already a member — keep the existing role
      });
      await tx.invitation.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date(), acceptedByUserId: userId },
      });
    });

    return this.auth.switchOrg(userId, invite.organizationId);
  }

  private async require(organizationId: string, id: string) {
    const invite = await this.prisma.invitation.findFirst({
      where: { id, organizationId },
    });
    if (!invite) throw new NotFoundException('Invitation not found');
    return invite;
  }

  private async sendMail(invite: Invitation, rawToken: string) {
    const [org, inviter] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: invite.organizationId },
      }),
      invite.invitedById
        ? this.prisma.user.findUnique({ where: { id: invite.invitedById } })
        : null,
    ]);
    return this.mail.sendInvitation({
      to: invite.email,
      orgName: org?.name ?? 'an organization',
      inviterName: inviter?.name ?? null,
      role: invite.role,
      inviteUrl: this.inviteUrl(rawToken),
      expiresAt: invite.expiresAt,
      // Recipient's language is unknown — use the inviter's.
      locale: inviter?.locale,
    });
  }
}
