import { IsString, MaxLength, MinLength } from 'class-validator';

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  sessionId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  to!: string; // msisdn or full jid

  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}
