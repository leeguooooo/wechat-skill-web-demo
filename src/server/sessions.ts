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
/// How many tail messages of each thread to persist on disk. The full
/// in-memory thread is bounded at THREAD_CAP=200; we save the last 50
/// to keep the cache file tractable while still letting the user open
/// any cached chat and immediately see context (instead of "(empty)"
/// until the next live message arrives).
const CACHED_THREAD_TAIL = 50;
const CACHE_FILE = join(homedir(), '.wechat-skill-web-demo', 'sessions.json');
const CACHE_VERSION = 2;
const FLUSH_DEBOUNCE_MS = 5_000;

export interface ConversationRef {
  id: string;
  kind: ConversationKind;
  displayName: string;
  memberCount?: number;
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
    /// Tail of the conversation (last CACHED_THREAD_TAIL records), persisted
    /// so reopening a chat after restart shows context immediately.
    /// v2+ schema; v1 cache files miss this and start with [] threads.
    thread?: MessageRecord[];
    /// Group member count, optional. Populated after login from
    /// `room.memberAll().length` and refreshed on each incoming message.
    memberCount?: number;
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
        ref: {
          ...entry.ref,
          memberCount: entry.memberCount ?? entry.ref.memberCount,
        },
        lastPreview: entry.lastPreview,
        lastTs: entry.lastTs,
        unread: entry.unread,
        thread: Array.isArray(entry.thread) ? entry.thread.slice() : [],
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
      thread: s.thread.slice(-CACHED_THREAD_TAIL),
      memberCount: s.ref.memberCount,
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
  // For binary kinds we keep the icon-style placeholder so the sidebar shows
  // "[图片]" / "[视频]" — the actual bytes are too big for a 30-char preview.
  // For everything else (text + url/miniprogram/system/etc with extracted
  // titles in msg.text), prefer the real text. msg.text was set in
  // messages.ts → only contains a placeholder when truly empty.
  const binary = msg.kind === 'image' || msg.kind === 'video'
    || msg.kind === 'audio' || msg.kind === 'file';
  let text: string;
  if (binary) {
    text = placeholderForKind(msg.kind);
  } else {
    text = msg.text || placeholderForKind(msg.kind);
  }
  if (text.length > PREVIEW_LIMIT) {
    return text.slice(0, PREVIEW_LIMIT - 1) + '…';
  }
  return text;
}

function placeholderForKind(kind: MessageRecord['kind']): string {
  switch (kind) {
    case 'image': return '[图片]';
    case 'video': return '[视频]';
    case 'audio': return '[语音]';
    case 'file': return '[文件]';
    case 'other': return '[消息]';
    default: return '';
  }
}

export function summarize(state: SessionState): SessionSummary {
  return {
    id: state.ref.id,
    kind: state.ref.kind,
    displayName: state.ref.displayName,
    lastPreview: state.lastPreview || '(暂无消息)',
    lastTs: state.lastTs,
    unread: state.unread,
    memberCount: state.ref.memberCount,
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
    if (ref.memberCount !== undefined) s.ref.memberCount = ref.memberCount;
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

/// Walk all known room sessions and update memberCount via the supplied
/// async lookup. Designed to be called once after wechaty login so that
/// rooms hydrated from the on-disk cache (which predates the field) get
/// their `(N)` count populated for the chat header.
export async function backfillRoomMemberCounts(
  fetch: (roomId: string) => Promise<number | undefined>,
): Promise<void> {
  let touched = 0;
  for (const s of sessions.values()) {
    if (s.ref.kind !== 'room') continue;
    if (typeof s.ref.memberCount === 'number') continue;
    const n = await fetch(s.ref.id).catch(() => undefined);
    if (typeof n === 'number') {
      s.ref.memberCount = n;
      touched += 1;
    }
  }
  if (touched > 0) {
    scheduleFlush();
  }
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
