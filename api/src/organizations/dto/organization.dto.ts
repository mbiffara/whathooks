import {
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
  ArrayMaxSize,
  IsArray,
} from 'class-validator';

// Invitable/assignable roles. OWNER is excluded on purpose: ownership only
// moves via the transfer-ownership endpoint.
const ASSIGNABLE_ROLES = ['ADMIN', 'MEMBER', 'OPERATOR'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export class InviteMemberDto {
  @IsEmail()
  email!: string;

  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}

export class UpdateMemberRoleDto {
  @IsIn(ASSIGNABLE_ROLES)
  role!: AssignableRole;
}

export class TransferOwnershipDto {
  @IsString()
  userId!: string;
}

export class UpdateMemberSessionsDto {
  // Empty array = access to all sessions (the default).
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  sessionIds!: string[];
}

export class UpdateOrganizationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;
}
