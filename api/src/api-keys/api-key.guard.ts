import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiKeysService } from './api-keys.service';

/**
 * Authenticates programmatic requests via an API key, supplied as either
 * `X-API-Key: <token>` or `Authorization: Bearer <token>`.
 * Attaches `request.organizationId` and `request.apiKeyId`.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly apiKeys: ApiKeysService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header =
      (req.headers['x-api-key'] as string) ||
      (typeof req.headers['authorization'] === 'string' &&
      req.headers['authorization'].startsWith('Bearer ')
        ? req.headers['authorization'].slice('Bearer '.length)
        : undefined);

    if (!header) throw new UnauthorizedException('Missing API key');

    const resolved = await this.apiKeys.resolve(header.trim());
    if (!resolved) throw new UnauthorizedException('Invalid API key');

    req.organizationId = resolved.organizationId;
    req.apiKeyId = resolved.apiKeyId;
    return true;
  }
}
