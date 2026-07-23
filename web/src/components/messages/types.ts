export type ChatMessageType =
  | "TEXT"
  | "IMAGE"
  | "AUDIO"
  | "VIDEO"
  | "DOCUMENT"
  | "STICKER"
  | "LOCATION"
  | "CONTACT"
  | "UNKNOWN";

export interface ChatMedia {
  url: string;
  mimeType: string;
  fileName: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  size: number | null;
}

export type MessageSource = "CONTACT" | "HUMAN" | "API" | "AGENT" | "NOTE";

export interface ConversationTag {
  id: string;
  name: string;
  color: string;
}

export interface ChatMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  fromMe: boolean;
  source?: MessageSource;
  agentName?: string | null;
  sentByName?: string | null;
  /** WhatsApp reactions on this message. */
  reactions?: { emoji: string; by: string }[];
  type: ChatMessageType;
  text: string | null;
  status: string;
  timestamp: string;
  media: ChatMedia | null;
}

export interface MessagesPage {
  items: ChatMessage[];
  hasMore: boolean;
  before: string | null;
}

export interface Conversation {
  id: string;
  sessionId: string;
  remoteJid: string;
  contact: string;
  name: string | null;
  isGroup: boolean;
  unreadCount: number;
  lastMessageAt: string | null;
  lastMessageText: string | null;
  lastMessageType: string | null;
  agent: ConversationAgent | null;
  agentPaused: boolean;
  agentPausedReason: string | null;
  status: "OPEN" | "RESOLVED";
  tags: ConversationTag[];
  assignedTo: { id: string; name: string } | null;
}

export interface ConversationAgent {
  id: string;
  name: string;
  enabled: boolean;
}
