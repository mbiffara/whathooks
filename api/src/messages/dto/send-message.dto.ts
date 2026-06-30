import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  sessionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  to!: string; // msisdn or full jid

  // Text body, or caption when sending media.
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  // When set, the media at this URL is fetched and sent (image/audio/video/document).
  @IsOptional()
  @IsUrl({ require_tld: false })
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  fileName?: string;
}
