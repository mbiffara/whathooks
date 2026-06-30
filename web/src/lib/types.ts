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
  lastConnectedAt: string | null;
  createdAt: string;
  live: boolean;
}

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
