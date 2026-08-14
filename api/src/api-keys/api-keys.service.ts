import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiKey } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async list(organizationId: string) {
    const keys = await this.prisma.apiKey.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => this.toPublic(k));
  }

  async create(
    organizationId: string,
    name: string,
    grant: { scopes: string[]; sessionIds: string[] } = {
      scopes: [],
      sessionIds: [],
    },
  ) {
    // Session ids must belong to this org, or a key could be pinned to
    // another tenant's session and leak its existence through the allow-list.
    if (grant.sessionIds.length > 0) {
      const owned = await this.prisma.waSession.count({
        where: { organizationId, id: { in: grant.sessionIds } },
      });
      if (owned !== grant.sessionIds.length) {
        throw new NotFoundException('Session not found');
      }
    }
    const prefix = this.config.get<string>('API_KEY_PREFIX', 'wh_live');
    const token = `${prefix}_${randomBytes(24).toString('hex')}`;
    const key = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name,
        hashedKey: hashToken(token),
        prefix: `${token.slice(0, 16)}…`,
        scopes: grant.scopes,
        sessionIds: grant.sessionIds,
      },
    });
    // Full token shown only once.
    return { ...this.toPublic(key), token };
  }

  async revoke(organizationId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
    });
    if (!key) throw new NotFoundException('API key not found');
    await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  /**
   * Permanently remove a key.
   *
   * Only a revoked one. Hard-deleting a live key would silently break
   * whatever is using it with nothing left to explain why — revoking first
   * makes that a deliberate two-step, and leaves the row visible in the
   * meantime so someone can notice the integration go quiet and put it back.
   */
  async remove(organizationId: string, id: string) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, organizationId },
      select: { id: true, revokedAt: true },
    });
    if (!key) throw new NotFoundException('API key not found');
    if (!key.revokedAt) {
      throw new BadRequestException('Revoke the key before deleting it');
    }
    await this.prisma.apiKey.delete({ where: { id } });
    return { ok: true };
  }

  /** Resolve a raw token to its (active) organization, or null. */
  async resolve(token: string): Promise<{
    organizationId: string;
    apiKeyId: string;
    scopes: string[];
    /** Empty = every session in the org. */
    sessionIds: string[];
  } | null> {
    const key = await this.prisma.apiKey.findUnique({
      where: { hashedKey: hashToken(token) },
    });
    if (!key || key.revokedAt) return null;
    // best-effort last-used stamp
    void this.prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return {
      organizationId: key.organizationId,
      apiKeyId: key.id,
      scopes: key.scopes,
      sessionIds: key.sessionIds,
    };
  }

  private toPublic(k: ApiKey) {
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      scopes: k.scopes,
      sessionIds: k.sessionIds,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    };
  }
}
