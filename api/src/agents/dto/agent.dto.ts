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

export const AGENT_PROVIDERS = ['ANTHROPIC', 'OPENAI'] as const;
export type AgentProviderName = (typeof AGENT_PROVIDERS)[number];

// Suggested models per provider (the API accepts any non-empty string, so new
// models work without a backend change; these drive the frontend picker).
export const AGENT_MODELS: Record<AgentProviderName, string[]> = {
  ANTHROPIC: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'],
  OPENAI: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano'],
};

export const DEFAULT_MODEL: Record<AgentProviderName, string> = {
  ANTHROPIC: 'claude-opus-4-8',
  OPENAI: 'gpt-5.5',
};

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
  @IsIn(AGENT_PROVIDERS)
  provider?: AgentProviderName;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(400)
  apiKey!: string;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(8192)
  maxTokens?: number;

  @IsOptional()
  @IsBoolean()
  allowAutoStop?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  replyDelayMinSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  replyDelayMaxSeconds?: number;

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
  @IsIn(AGENT_PROVIDERS)
  provider?: AgentProviderName;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model?: string;

  // Optional on update — omit to keep the existing key.
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(400)
  apiKey?: string;

  @IsOptional()
  @IsInt()
  @Min(64)
  @Max(8192)
  maxTokens?: number;

  @IsOptional()
  @IsBoolean()
  allowAutoStop?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  replyDelayMinSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  replyDelayMaxSeconds?: number;

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
