import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** Org id attached by ApiKeyGuard for programmatic (API-key) requests. */
export const ApiOrg = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    return ctx.switchToHttp().getRequest().organizationId as string;
  },
);
