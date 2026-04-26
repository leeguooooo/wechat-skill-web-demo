// In-memory sessions + thread store, with on-disk cache for fast cold start.
//
// Wechaty doesn't expose a "recent sessions" feed natively (the puppet
// protocol is intentionally stateless — clients accumulate from the
// `on('message')` event stream). Standard wechaty pattern is:
//   1. On boot, hydrate sessions from local cache file → UI 1ms responsive
//   2. Subscribe `on('message')` → mutate in memory + debounced flush to disk
//   3. On exit, force-flush
// This is what `MemoryCard` does internally for credentials; we apply the
// same pattern for view state. Cache lives at:
//   ~/.wechat-skill-web-demo/sessions.json
// First-ever launch (no cache file) starts empty — UI can show the
// "(cache 已加载, 等待消息)" indicator.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import type {
  ConversationKind,
  MessageRecord,
  SessionSummary,
} from '../shared/types.js';

const PREVIEW_LIMIT = 30;
const THREAD_CAP = 200;
/// Threads are heavy (200 messages × N sessions) — only persist the
/// session metadata. Threads rebuild from the live event stream as the
/// user scrolls active conversations. This keeps the cache file < 100KB
/// even for users with thousands of historical chats.
const CACHE_FILE = join(homedir(), '.wechat-skill-web-demo', 'sessions.json');
const CACHE_VERSION = 1;
const FLUSH_DEBOUNCE_MS = 5_000;

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
let cacheLoaded = false;
let flushTimer: NodeJS.Timeout | null = null;
let dirty = false;

interface CacheFile {
  version: number;
  lastUpdate: number;
  sessions: Array<{
    ref: ConversationRef;
    lastPreview: string;
    lastTs: number;
    unread: number;
  }>;
}

/// Load persisted session metadata into memory. Idempotent — calling
/// twice is safe (the second call no-ops). Designed for a single
/// startup-time call from index.ts before wechaty's `start()` so the
/// UI sees populated sidebar within ms.
export function loadCache(): { loaded: boolean; sessionCount: number } {
  if (cacheLoaded) {
    return { loaded: true, sessionCount: sessions.size };
  }
  cacheLoaded = true;
  if (!existsSync(CACHE_FILE)) {
    return { loaded: false, sessionCount: 0 };
  }
  try {
    const raw = readFileSync(CACHE_FILE, 'utf8');
    const parsed = JSON.parse(raw) as CacheFile;
    if (parsed.version !== CACHE_VERSION) {
      console.warn(
        `[sessions] cache version mismatch (file=${parsed.version}, expected=${CACHE_VERSION}); ignoring`
      );
      return { loaded: false, sessionCount: 0 };
    }
    for (const entry of parsed.sessions) {
      sessions.set(entry.ref.id, {
        ref: { ...entry.ref },
        lastPreview: entry.lastPreview,
        lastTs: entry.lastTs,
        unread: entry.unread,
        thread: [], // not persisted; rebuilds from live events as user opens chats
      });
    }
    return { loaded: true, sessionCount: sessions.size };
  } catch (err) {
    console.warn('[sessions] cache load failed:', (err as Error).message);
    return { loaded: false, sessionCount: 0 };
  }
}

function flushCache(): void {
  if (!dirty) return;
  dirty = false;
  const data: CacheFile = {
    version: CACHE_VERSION,
    lastUpdate: Math.floor(Date.now() / 1000),
    sessions: [...sessions.values()].map((s) => ({
      ref: s.ref,
      lastPreview: s.lastPreview,
      lastTs: s.lastTs,
      unread: s.unread,
    })),
  };
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(data), { mode: 0o600 });
  } catch (err) {
    console.warn('[sessions] cache flush failed:', (err as Error).message);
  }
}

function scheduleFlush(): void {
  dirty = true;
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushCache();
  }, FLUSH_DEBOUNCE_MS);
}

/// Force flush, intended for shutdown handlers (SIGINT/SIGTERM).
/// Cancels any pending debounce timer and writes immediately.
export function flushCacheSync(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  dirty = true;
  flushCache();
}

export function setActiveConversation(id: string | null) {
  activeConversationId = id;
  if (id && sessions.has(id)) {
    const s = sessions.get(id)!;
    if (s.unread !== 0) {
      s.unread = 0;
      scheduleFlush();
    }
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
  scheduleFlush();
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
