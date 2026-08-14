import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiKeysService } from './api-keys.service';
import { SCOPES_KEY, type ApiKeyScope } from './scopes';

/**
 * Authenticates programmatic requests via an API key, supplied as either
 * `X-API-Key: <token>` or `Authorization: Bearer <token>`.
 * Attaches `request.organizationId`, `request.apiKeyId` and the key's session
 * allow-list, and enforces any `@RequireScopes` on the route.
 *
 * The scope check is duplicated from JwtOrApiKeyGuard rather than shared,
 * because the two guards authenticate differently and the alternative — one
 * guard enforcing and the other not — is exactly the hole this had: the send
 * route uses this guard, so a decorator honoured only by the other one would
 * have left the single most sensitive endpoint unscoped while appearing
 * annotated.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      Request & {
        organizationId?: string;
        apiKeyId?: string;
        apiKeySessionIds?: string[];
      }
    >();
    const auth = req.headers['authorization'];
    const header =
      (req.headers['x-api-key'] as string | undefined) ||
      (typeof auth === 'string' && auth.startsWith('Bearer ')
        ? auth.slice('Bearer '.length)
        : undefined);

    if (!header) throw new UnauthorizedException('Missing API key');

    const resolved = await this.apiKeys.resolve(header.trim());
    if (!resolved) throw new UnauthorizedException('Invalid API key');

    const required =
      this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
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
}
