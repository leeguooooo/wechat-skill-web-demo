// In-memory sessions + thread store.
//
// Wechaty doesn't expose a "recent sessions" feed natively, so we synthesize
// one by observing every inbound and outbound message. Threads are kept as
// bounded ring buffers (last 200 each) — the UI only renders the last 50.

import type {
  ConversationKind,
  MessageRecord,
  SessionSummary,
} from '../shared/types.js';

const PREVIEW_LIMIT = 30;
const THREAD_CAP = 200;

export interface ConversationRef {
  id: string;
  kind: ConversationKind;
  displayName: string;
}

interface SessionState {
  ref: ConversationRef;
  lastPreview: string;
  lastTs: number;
  unread: number;
  thread: MessageRecord[];
}

const sessions = new Map<string, SessionState>();
let activeConversationId: string | null = null;

export function setActiveConversation(id: string | null) {
  activeConversationId = id;
  if (id && sessions.has(id)) {
    const s = sessions.get(id)!;
    s.unread = 0;
  }
}

export function getActiveConversationId(): string | null {
  return activeConversationId;
}

function previewOf(msg: MessageRecord): string {
  let text: string;
  switch (msg.kind) {
    case 'image':
      text = '[图片]';
      break;
    case 'video':
      text = '[视频]';
      break;
    case 'audio':
      text = '[语音]';
      break;
    case 'file':
      text = '[文件]';
      break;
    case 'other':
      text = '[消息]';
      break;
    default:
      text = msg.text || '';
  }
  if (text.length > PREVIEW_LIMIT) {
    return text.slice(0, PREVIEW_LIMIT - 1) + '…';
  }
  return text;
}

export function summarize(state: SessionState): SessionSummary {
  return {
    id: state.ref.id,
    kind: state.ref.kind,
    displayName: state.ref.displayName,
    lastPreview: state.lastPreview || '(暂无消息)',
    lastTs: state.lastTs,
    unread: state.unread,
  };
}

export function ingest(ref: ConversationRef, msg: MessageRecord): SessionSummary {
  let s = sessions.get(ref.id);
  if (!s) {
    s = {
      ref: { ...ref },
      lastPreview: '',
      lastTs: 0,
      unread: 0,
      thread: [],
    };
    sessions.set(ref.id, s);
  } else {
    // Refresh display name in case room topic / contact name changed.
    s.ref.displayName = ref.displayName;
    s.ref.kind = ref.kind;
  }
  // De-dup by id (wechaty can occasionally re-emit the same message during recovery).
  if (!s.thread.some((m) => m.id === msg.id)) {
    s.thread.push(msg);
    if (s.thread.length > THREAD_CAP) s.thread.splice(0, s.thread.length - THREAD_CAP);
  }
  s.lastPreview = previewOf(msg);
  s.lastTs = msg.ts;
  if (!msg.self && activeConversationId !== ref.id) {
    s.unread += 1;
  }
  return summarize(s);
}

export function listSessions(): SessionSummary[] {
  return [...sessions.values()]
    .map(summarize)
    .sort((a, b) => b.lastTs - a.lastTs);
}

export function getThread(conversationId: string, limit = 50): MessageRecord[] {
  const s = sessions.get(conversationId);
  if (!s) return [];
  return s.thread.slice(-limit);
}

export function ensureSession(ref: ConversationRef): SessionSummary {
  let s = sessions.get(ref.id);
  if (!s) {
    s = {
      ref: { ...ref },
      lastPreview: '',
      lastTs: 0,
      unread: 0,
      thread: [],
    };
    sessions.set(ref.id, s);
  }
  return summarize(s);
}

export function patchMessageImage(messageId: string, dataUrl: string): MessageRecord | null {
  for (const s of sessions.values()) {
    const m = s.thread.find((x) => x.id === messageId);
    if (m) {
      m.imageDataUrl = dataUrl;
      return m;
    }
  }
  return null;
}
