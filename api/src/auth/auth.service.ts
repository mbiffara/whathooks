import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Membership, Organization, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes } from 'crypto';
import { hashToken } from '../api-keys/api-keys.service';
import { MailService } from '../mail/mail.service';
import { XConversionsService } from '../marketing/x-conversions.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ForgotPasswordDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';

type MembershipWithOrg = Membership & { organization: Organization };

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
/** Max reset emails per address within the TTL window (abuse brake). */
const RESET_MAX_OUTSTANDING = 3;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly xConversions: XConversionsService,
  ) {}

  signFor(user: User): string {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      orgId: user.organizationId,
    };
    return this.jwt.sign(payload);
  }

  private publicUser(user: User, memberships: MembershipWithOrg[]) {
    const active = memberships.find(
      (m) => m.organizationId === user.organizationId,
    );
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      locale: user.locale,
      role: user.role,
      organizationId: user.organizationId,
      orgRole: active?.role ?? null,
      organizations: memberships.map((m) => ({
        id: m.organizationId,
        name: m.organization.name,
        role: m.role,
      })),
    };
  }

  /**
   * Ensures User.organizationId points at an org the user is actually a
   * member of (memberships are the source of truth), then returns the
   * user + token response shape shared by register/login/switch-org.
   */
  private async buildAuthResponse(userId: string) {
    let user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();

    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });

    const activeOrgId = user.organizationId;
    const activeIsValid =
      activeOrgId && memberships.some((m) => m.organizationId === activeOrgId);
    // Platform ADMINs have no memberships and keep a null org.
    if (!activeIsValid && user.role === 'CLIENT') {
      const next = memberships[0]?.organizationId ?? null;
      if (user.organizationId !== next) {
        user = await this.prisma.user.update({
          where: { id: userId },
          data: { organizationId: next },
        });
      }
    }

    return {
      user: this.publicUser(user, memberships),
      token: this.signFor(user),
    };
  }

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('Email already registered');

    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.$transaction(async (tx) => {
      if (dto.inviteToken) {
        // Joining an existing organization via invitation.
        const invite = await tx.invitation.findUnique({
          where: { tokenHash: hashToken(dto.inviteToken) },
        });
        if (
          !invite ||
          invite.acceptedAt ||
          invite.revokedAt ||
          invite.expiresAt < new Date()
        ) {
          throw new BadRequestException('Invitation is invalid or has expired');
        }
        const created = await tx.user.create({
          data: {
            email,
            passwordHash,
            name: dto.name,
            locale: normalizeLocale(dto.locale),
            role: 'CLIENT',
            organizationId: invite.organizationId,
          },
        });
        await tx.membership.create({
          data: {
            userId: created.id,
            organizationId: invite.organizationId,
            role: invite.role,
          },
        });
        await tx.invitation.update({
          where: { id: invite.id },
          data: { acceptedAt: new Date(), acceptedByUserId: created.id },
        });
        return created;
      }

      // First user of a new organization becomes its owner. The twclid (X ad
      // click id) is kept on the org so the later paid-subscription
      // conversion can be attributed from the Stripe webhook.
      const org = await tx.organization.create({
        data: {
          name: dto.organizationName!,
          adClickId: dto.twclid?.trim() || null,
        },
      });
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: dto.name,
          locale: normalizeLocale(dto.locale),
          role: 'CLIENT',
          organizationId: org.id,
        },
      });
      await tx.membership.create({
        data: { userId: created.id, organizationId: org.id, role: 'OWNER' },
      });
      return created;
    });

    this.xConversions.trackSignup(dto.twclid, user.id);
    return this.buildAuthResponse(user.id);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const valid = await argon2.verify(user.passwordHash, dto.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.buildAuthResponse(user.id);
  }

  /**
   * Issue a reset link. Always resolves to the same response so the endpoint
   * can't be used to probe which emails are registered.
   */
  async forgotPassword(dto: ForgotPasswordDto): Promise<{ ok: true }> {
    const email = dto.email.toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return { ok: true };

    // Brake: don't mint unlimited tokens/emails for one address.
    const outstanding = await this.prisma.passwordResetToken.count({
      where: {
        userId: user.id,
        usedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
    if (outstanding >= RESET_MAX_OUTSTANDING) return { ok: true };

    const rawToken = randomBytes(24).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const origin = this.config
      .get<string>('WEB_ORIGIN', 'http://localhost:3000')
      .split(',')[0]
      .trim();
    await this.mail.sendPasswordReset({
      to: email,
      resetUrl: `${origin}/reset-password?token=${rawToken}`,
      locale: user.locale,
    });
    return { ok: true };
  }

  /** Redeem a reset token: set the new password, burn every open token. */
  async resetPassword(dto: ResetPasswordDto): Promise<{ ok: true }> {
    const token = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });
    if (!token || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException(
        'This reset link is invalid or has expired. Request a new one.',
      );
    }

    const passwordHash = await argon2.hash(dto.password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: token.id },
        data: { usedAt: new Date() },
      }),
      // Any other outstanding links for this user die with the reset.
      this.prisma.passwordResetToken.deleteMany({
        where: { userId: token.userId, usedAt: null, id: { not: token.id } },
      }),
    ]);
    return { ok: true };
  }

  /** Update profile fields (name, UI/email language). */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.locale !== undefined
          ? { locale: normalizeLocale(dto.locale) }
          : {}),
      },
    });
    return this.me(userId);
  }

  async switchOrg(userId: string, organizationId: string) {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
    });
    if (!membership) {
      throw new ForbiddenException('Not a member of this organization');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: { organizationId },
    });
    return this.buildAuthResponse(userId);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException();
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    });
    const active = memberships.find(
      (m) => m.organizationId === user.organizationId,
    );
    return {
      ...this.publicUser(user, memberships),
      organization: active
        ? { id: active.organizationId, name: active.organization.name }
        : null,
    };
  }
}

function normalizeLocale(value: string | undefined): string {
  return value === 'es' ? 'es' : 'en';
}
