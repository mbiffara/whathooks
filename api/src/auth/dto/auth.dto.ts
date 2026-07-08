import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  // Required when creating a new organization; omitted when joining via invite.
  @ValidateIf((o: RegisterDto) => !o.inviteToken)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  organizationName?: string;

  @IsOptional()
  @IsString()
  inviteToken?: string;
}

export class SwitchOrgDto {
  @IsString()
  organizationId!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}
