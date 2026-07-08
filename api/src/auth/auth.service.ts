import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Membership, Organization, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { hashToken } from '../api-keys/api-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtPayload } from './jwt.strategy';

type MembershipWithOrg = Membership & { organization: Organization };

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
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

      // First user of a new organization becomes its owner.
      const org = await tx.organization.create({
        data: { name: dto.organizationName! },
      });
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          name: dto.name,
          role: 'CLIENT',
          organizationId: org.id,
        },
      });
      await tx.membership.create({
        data: { userId: created.id, organizationId: org.id, role: 'OWNER' },
      });
      return created;
    });

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
