import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { ForbiddenException } from '@nestjs/common';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service';
import { SCOPES_KEY, type ApiKeyScope } from './scopes';

/**
 * Accepts either a dashboard JWT or a programmatic API key on the same route.
 * API keys arrive as `X-API-Key: <token>` or `Authorization: Bearer <token>`
 * (distinguished from JWTs, which always start with "eyJ"). Both paths attach
 * `request.organizationId`; API-key requests also get `request.apiKeyId`,
 * which OrgRolesGuard treats as full org access (the key is an org-scoped
 * machine credential — it can already perform the most privileged operation,
 * sending messages).
 */
@Injectable()
export class JwtOrApiKeyGuard extends AuthGuard('jwt') {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & {
        organizationId?: string;
        apiKeyId?: string;
        apiKeySessionIds?: string[];
        user?: { organizationId?: string | null };
      }
    >();

    const bearer =
      typeof req.headers['authorization'] === 'string' &&
      req.headers['authorization'].startsWith('Bearer ')
        ? req.headers['authorization'].slice('Bearer '.length).trim()
        : undefined;
    const apiKey =
      (req.headers['x-api-key'] as string | undefined)?.trim() ??
      (bearer && !bearer.startsWith('eyJ') ? bearer : undefined);

    if (apiKey) {
      const resolved = await this.apiKeys.resolve(apiKey);
      if (!resolved) throw new UnauthorizedException('Invalid API key');

      // Scopes gate the credential, not the person. A route with no
      // @RequireScopes stays open to any valid key, so annotating is additive
      // and an un-annotated route cannot start failing.
      const required =
        this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(
          SCOPES_KEY,
          [context.getHandler(), context.getClass()],
        ) ?? [];
      const missing = required.filter((s) => !resolved.scopes.includes(s));
      if (missing.length > 0) {
        throw new ForbiddenException(
          `This API key is missing the ${missing.join(', ')} scope(s).`,
        );
      }

      req.organizationId = resolved.organizationId;
      req.apiKeyId = resolved.apiKeyId;
      // Empty means unrestricted, matching Membership.sessionIds.
      req.apiKeySessionIds = resolved.sessionIds.length
        ? resolved.sessionIds
        : undefined;
      return true;
    }

    const ok = (await super.canActivate(context)) as boolean;
    if (ok) req.organizationId = req.user?.organizationId ?? undefined;
    return ok;
  }
}
