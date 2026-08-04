import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/**
 * One payload-projection rule. Cross-field constraints (exactly one of
 * source/value, target uniqueness, path syntax) are checked by
 * mappingRulesError() in the service, where a friendly message is easier.
 */
export class MappingRuleDto {
  @IsString()
  @MaxLength(64)
  target!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  source?: string;

  @IsOptional()
  value?: string | number | boolean | null;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  dateFormat?: string;
}

export const WEBHOOK_EVENTS = [
  'message.received',
  'session.status',
  'session.qr',
  'contact.created',
  'contact.updated',
] as const;

export class CreateWebhookDto {
  @IsUrl({ require_tld: false })
  url!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events!: string[];

  @IsOptional()
  @IsString()
  sessionId?: string;

  // Empty array (or omitted) = deliver the default payload.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingRuleDto)
  payloadMapping?: MappingRuleDto[];
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(WEBHOOK_EVENTS, { each: true })
  events?: string[];

  @IsOptional()
  @IsBoolean()
  active?: boolean;

  // Empty array clears the mapping (reverts to the default payload).
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MappingRuleDto)
  payloadMapping?: MappingRuleDto[];
}
