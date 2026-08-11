import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

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

  /**
   * Restrict to one channel. Omit for every channel. Webhooks created before
   * Instagram existed were pinned to WHATSAPP by migration, since their
   * consumers assume `from` is a phone jid.
   */
  @IsOptional()
  @IsIn(['WHATSAPP', 'INSTAGRAM'])
  channel?: 'WHATSAPP' | 'INSTAGRAM';

  // Per-event rule lists ({ event: rules }) or a legacy flat rule array
  // (read as message.received). Shape + rules validated in the service
  // (mappingsError), where friendly messages are easier. Omitted/empty =
  // deliver the default payload for every event.
  @IsOptional()
  payloadMapping?: unknown;
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
  // See CreateWebhookDto.payloadMapping; {} clears every mapping.
  @IsOptional()
  payloadMapping?: unknown;
}
