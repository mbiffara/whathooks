export type WaStatus =
  | "PENDING"
  | "QR"
  | "CONNECTING"
  | "CONNECTED"
  | "DISCONNECTED"
  | "LOGGED_OUT";

export interface WaSession {
  id: string;
  label: string;
  status: WaStatus;
  phoneNumber: string | null;
  agentId: string | null;
  lastConnectedAt: string | null;
  createdAt: string;
  live: boolean;
}

export type AgentProvider = "ANTHROPIC" | "OPENAI";

export interface Agent {
  id: string;
  name: string;
  soul: string;
  instructions: string;
  provider: AgentProvider;
  model: string;
  apiKeyHint: string;
  maxTokens: number;
  allowAutoStop: boolean;
  replyDelayMinSeconds: number;
  replyDelayMaxSeconds: number;
  enabled: boolean;
  sessionCount: number;
  createdAt: string;
  updatedAt?: string;
}

export const AGENT_PROVIDERS: { id: AgentProvider; label: string }[] = [
  { id: "ANTHROPIC", label: "Anthropic (Claude)" },
  { id: "OPENAI", label: "OpenAI (ChatGPT)" },
];

export const AGENT_MODELS: Record<
  AgentProvider,
  { id: string; label: string }[]
> = {
  ANTHROPIC: [
    { id: "claude-opus-4-8", label: "Claude Opus 4.8 — most capable" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — balanced" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — fastest & cheapest" },
  ],
  OPENAI: [
    { id: "gpt-5.5", label: "GPT-5.5 — most capable" },
    { id: "gpt-5.4", label: "GPT-5.4 — more affordable" },
    { id: "gpt-5.4-mini", label: "GPT-5.4 mini — fast & cheap" },
    { id: "gpt-5.4-nano", label: "GPT-5.4 nano — cheapest, high-volume" },
  ],
};

export interface WaSessionDetail extends WaSession {
  qr: string | null;
  qrDataUrl: string | null;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  sessionId: string | null;
  active: boolean;
  secretHint: string;
  secret?: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  token?: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface MessageLog {
  id: string;
  sessionId: string;
  direction: "INBOUND" | "OUTBOUND";
  remoteJid: string;
  contactName: string | null;
  type: string;
  text: string | null;
  status: string;
  createdAt: string;
}

export interface AdminOverview {
  organizations: number;
  users: number;
  sessions: number;
  connected: number;
  conversations: number;
  messages: number;
  webhooks: number;
  system: {
    liveSessions: number;
    memoryUsedMB: number;
    memoryLimitMB: number | null;
    memoryPercent: number | null;
    uptimeSeconds: number;
  };
}

export interface AdminOrg {
  id: string;
  name: string;
  createdAt: string;
  users: number;
  sessions: number;
  webhooks: number;
  conversations: number;
  messages: number;
}

export interface AdminOrgDetail {
  id: string;
  name: string;
  createdAt: string;
  users: {
    id: string;
    email: string;
    name: string | null;
    role: "ADMIN" | "CLIENT";
    createdAt: string;
  }[];
  sessions: {
    id: string;
    label: string;
    status: WaStatus;
    phoneNumber: string | null;
    lastConnectedAt: string | null;
    createdAt: string;
  }[];
  webhooks: {
    id: string;
    url: string;
    events: string[];
    active: boolean;
    sessionId: string | null;
    createdAt: string;
  }[];
  apiKeys: {
    id: string;
    name: string;
    prefix: string;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }[];
  counts: { conversations: number; messages: number };
}
