import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  userId: string;
  email: string;
  role: 'ADMIN' | 'CLIENT';
  organizationId: string | null;
  // Role in the active organization; set by OrgRolesGuard from the DB.
  orgRole?: 'OWNER' | 'ADMIN' | 'MEMBER';
}

export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as AuthUser;
    return data ? user?.[data] : user;
  },
);
