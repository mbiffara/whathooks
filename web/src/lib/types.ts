export type WaStatus =
  "PENDING" | "QR" | "CONNECTING" | "CONNECTED" | "DISCONNECTED" | "LOGGED_OUT";

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

/** MCP server on an agent (tokens never returned — only a hint). */
export interface AgentMcpServer {
  name: string;
  url: string;
  hasAuth: boolean;
  authTokenHint: string | null;
}

export interface Agent {
  id: string;
  name: string;
  soul: string;
  instructions: string;
  provider: AgentProvider;
  model: string;
  apiKeyHint: string;
  mcpServers: AgentMcpServer[];
  maxTokens: number;
  allowAutoStop: boolean;
  notifyOnHandoff: boolean;
  replyDelayMinSeconds: number;
  replyDelayMaxSeconds: number;
  scheduleEnabled: boolean;
  scheduleDays: number[];
  scheduleStartMinute: number;
  scheduleEndMinute: number;
  scheduleTimezone: string;
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

/** One webhook payload-projection rule: exactly one of source/value. */
export interface MappingRule {
  target: string;
  source?: string;
  value?: string | number | boolean | null;
  dateFormat?: string;
}

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  sessionId: string | null;
  active: boolean;
  payloadMapping: MappingRule[] | null;
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
  media: {
    url: string;
    mimeType: string;
    fileName: string | null;
    size: number | null;
  } | null;
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
  plan: Plan;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  owner: {
    id: string;
    email: string;
    locale: string;
    welcomeEmailSentAt: string | null;
  } | null;
  users: number;
  sessions: number;
  agents: number;
  webhooks: number;
  conversations: number;
  messages: number;
}

export interface AdminOrgDetail {
  id: string;
  name: string;
  createdAt: string;
  billing: {
    plan: Plan;
    planLabel: string;
    subscriptionStatus: string | null;
    currentPeriodEnd: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    usage: { used: number; limit: number | null };
  };
  users: {
    id: string;
    email: string;
    name: string | null;
    role: "ADMIN" | "CLIENT";
    locale: string;
    orgRole: OrgRole;
    welcomeEmailSentAt: string | null;
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

// --- Team / organizations -------------------------------------------------

export type OrgRole = "OWNER" | "ADMIN" | "MEMBER";

export interface OrgMembership {
  id: string;
  name: string;
  role: OrgRole;
  joinedAt: string;
}

export interface TeamMember {
  userId: string;
  email: string;
  name: string | null;
  role: OrgRole;
  /** Session allow-list; empty = access to all sessions. */
  sessionIds: string[];
  joinedAt: string;
}

export type InvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED";

export interface Invitation {
  id: string;
  email: string;
  role: OrgRole;
  status: InvitationStatus;
  expiresAt: string;
  createdAt: string;
}

export interface InvitationCreated {
  invitation: Invitation;
  inviteUrl: string;
  emailSent: boolean;
}

export type Plan = "STARTER" | "PRO" | "BUSINESS" | "SPONSORED";

/** Plans a user can buy (SPONSORED is assigned manually). */
export type PurchasablePlan = Exclude<Plan, "SPONSORED">;

export interface PlanLimits {
  label: string;
  /** null = unlimited */
  messagesPerMonth: number | null;
  historyDays: number | null;
  /** null = unlimited */
  waNumbers: number | null;
}

export interface Subscription {
  plan: Plan;
  limits: PlanLimits;
  status: string | null;
  /** False for orgs with no live subscription (plan is only the default tier). */
  subscribed: boolean;
  currentPeriodEnd: string | null;
  hasCustomer: boolean;
  usage: { used: number; limit: number | null };
}

export const PLAN_PRICING: Record<Plan, { label: string; price: string }> = {
  STARTER: { label: "Starter", price: "$8.99" },
  PRO: { label: "Pro", price: "$24.99" },
  BUSINESS: { label: "Business", price: "$79.99" },
  SPONSORED: { label: "Sponsored", price: "—" },
};
