import {
  IsEmail,
  IsIn,
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

  // X ads click id (twclid) captured on the landing page — ad attribution only.
  @IsOptional()
  @IsString()
  @MaxLength(120)
  twclid?: string;

  // Visitor's UI language at signup ("en" | "es").
  @IsOptional()
  @IsIn(['en', 'es'])
  locale?: string;
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

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  // Same policy as RegisterDto.password.
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;
}

export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsIn(['en', 'es'])
  locale?: string;
}
