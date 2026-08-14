import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/**
 * The session allow-list of the API key that made this request, or undefined
 * for dashboard requests and unrestricted keys.
 *
 * Passed to SessionAccessService alongside the user so both restrictions
 * resolve in one place rather than each route remembering two rules.
 */
export const ApiKeySessions = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string[] | undefined =>
    ctx.switchToHttp().getRequest<{ apiKeySessionIds?: string[] }>()
      .apiKeySessionIds,
);
