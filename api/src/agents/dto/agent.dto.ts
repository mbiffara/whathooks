import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const AGENT_MODELS = [
  'claude-opus-4-8',
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
] as const;

export class CreateAgentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  soul!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  instructions!: string;

  @IsOptional()
  @IsIn(AGENT_MODELS)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(8192)
  maxTokens?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  soul?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  instructions?: string;

  @IsOptional()
  @IsIn(AGENT_MODELS)
  model?: string;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(8192)
  maxTokens?: number;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AssignAgentDto {
  // null/empty clears the assignment
  @IsOptional()
  @IsString()
  agentId?: string | null;
}
