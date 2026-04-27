// Shared type definitions used by both server and client.
// Keep this file framework-agnostic (no svelte/express imports).

export type ConversationKind = 'dm' | 'room';

export interface SessionSummary {
  /** Stable id: contact id for DMs, room id for groups. */
  id: string;
  kind: ConversationKind;
  displayName: string;
  /** Up to ~30 chars, truncated by server. */
  lastPreview: string;
  /** ms epoch of last message, or 0 if none. */
  lastTs: number;
  unread: number;
  /** Group member count, surfaced as "Topic (N)" in the chat header. */
  memberCount?: number;
}

export type MessageDisplayKind = 'text' | 'image' | 'video' | 'audio' | 'file' | 'other';

export interface MessageRecord {
  /** Wechaty message id. */
  id: string;
  /** Conversation id (room id or counterparty contact id). */
  conversationId: string;
  conversationKind: ConversationKind;
  /** Sender display name (for DM = counterparty, for room = speaker). */
  senderName: string;
  /** True if this client (logged-in user) sent the message. */
  self: boolean;
  kind: MessageDisplayKind;
  text: string;
  /** ms epoch. */
  ts: number;
  /** For images: data URL of thumbnail (base64). Optional, lazy-loaded. */
  imageDataUrl?: string;
}

export type LoginState =
  | { status: 'connecting' }
  | { status: 'reconnecting' }
  | { status: 'logged-in'; userId: string; userName: string }
  | { status: 'logged-out' }
  | { status: 'error'; message: string };

// ---- WebSocket envelope ----------------------------------------------------

export type ServerEvent =
  | { type: 'login-state'; state: LoginState }
  | { type: 'sessions-snapshot'; sessions: SessionSummary[] }
  | { type: 'message'; message: MessageRecord; session: SessionSummary }
  | { type: 'image-ready'; messageId: string; imageDataUrl: string }
  | { type: 'error'; message: string };

export type ClientCommand =
  | { type: 'open-session'; conversationId: string }
  | { type: 'send-text'; conversationId: string; text: string; clientNonce: string }
  | { type: 'request-image'; messageId: string };

// ---- HTTP REST shapes ------------------------------------------------------

export interface SessionsResponse {
  sessions: SessionSummary[];
  loginState: LoginState;
}

export interface ThreadResponse {
  conversationId: string;
  messages: MessageRecord[];
}
