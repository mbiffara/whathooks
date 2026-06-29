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
  type: string;
  content: { text?: string | null; pushName?: string | null };
  status: string;
  createdAt: string;
}

export interface AdminOverview {
  organizations: number;
  users: number;
  sessions: number;
  connected: number;
  messages: number;
  webhooks: number;
}

export interface AdminOrg {
  id: string;
  name: string;
  createdAt: string;
  users: number;
  sessions: number;
  webhooks: number;
  messages: number;
}
