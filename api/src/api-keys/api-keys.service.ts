import { Injectable, NotFoundException } from '@nestjs/common';
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

  async create(organizationId: string, name: string) {
    const prefix = this.config.get<string>('API_KEY_PREFIX', 'wh_live');
    const token = `${prefix}_${randomBytes(24).toString('hex')}`;
    const key = await this.prisma.apiKey.create({
      data: {
        organizationId,
        name,
        hashedKey: hashToken(token),
        prefix: `${token.slice(0, 16)}…`,
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

  /** Resolve a raw token to its (active) organization, or null. */
  async resolve(
    token: string,
  ): Promise<{ organizationId: string; apiKeyId: string } | null> {
    const key = await this.prisma.apiKey.findUnique({
      where: { hashedKey: hashToken(token) },
    });
    if (!key || key.revokedAt) return null;
    // best-effort last-used stamp
    void this.prisma.apiKey
      .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);
    return { organizationId: key.organizationId, apiKeyId: key.id };
  }

  private toPublic(k: ApiKey) {
    return {
      id: k.id,
      name: k.name,
      prefix: k.prefix,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      createdAt: k.createdAt,
    };
  }
}
