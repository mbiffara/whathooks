import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;
}

export class UpdateSessionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label?: string;

  /** Auto-save inbound DM senders into the org's contact book. */
  @IsOptional()
  @IsBoolean()
  saveContacts?: boolean;
}
