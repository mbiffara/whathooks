import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service';

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
  constructor(private readonly apiKeys: ApiKeysService) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & {
        organizationId?: string;
        apiKeyId?: string;
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
      req.organizationId = resolved.organizationId;
      req.apiKeyId = resolved.apiKeyId;
      return true;
    }

    const ok = (await super.canActivate(context)) as boolean;
    if (ok) req.organizationId = req.user?.organizationId ?? undefined;
    return ok;
  }
}
