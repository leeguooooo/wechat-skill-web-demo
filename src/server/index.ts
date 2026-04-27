// Entry point: HTTP REST endpoints + WebSocket upgrade + wechaty wiring.

import http from 'node:http';
import express from 'express';
import type { Request, Response } from 'express';
import type { Message } from 'wechaty';
import { getWechaty, getLoginState, onLoginStateChange } from './wechaty.js';
import {
  backfillRoomMemberCounts,
  ensureSession,
  flushCacheSync,
  getThread,
  ingest,
  listSessions,
  loadCache,
  patchMessageImage,
  setActiveConversation,
} from './sessions.js';
import { makeRecord, resolveConversation } from './messages.js';
import { createWsHub } from './ws.js';
import { getCached, setCached } from './imageCache.js';
import type {
  ClientCommand,
  MessageRecord,
  ServerEvent,
  SessionsResponse,
  ThreadResponse,
} from '../shared/types.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(express.json({ limit: '64kb' }));

const hub = createWsHub({
  onConnect: (ws) => {
    // Greet the new client with a snapshot.
    const evt1: ServerEvent = { type: 'login-state', state: getLoginState() };
    const evt2: ServerEvent = { type: 'sessions-snapshot', sessions: listSessions() };
    ws.send(JSON.stringify(evt1));
    ws.send(JSON.stringify(evt2));
  },
  onCommand: async (cmd) => {
    try {
      await handleCommand(cmd);
    } catch (err) {
      console.error('[ws] command failed:', cmd.type, (err as Error).message);
    }
  },
});

// Push login-state changes to all browsers.
onLoginStateChange((state) => {
  hub.broadcast({ type: 'login-state', state });
});

// ---- HTTP API --------------------------------------------------------------

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true, ts: Date.now(), loginState: getLoginState() });
});

app.get('/api/sessions', (_req: Request, res: Response) => {
  const body: SessionsResponse = {
    sessions: listSessions(),
    loginState: getLoginState(),
  };
  res.json(body);
});

app.get('/api/threads/:id', (req: Request, res: Response) => {
  const id = req.params.id;
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
  const body: ThreadResponse = {
    conversationId: id,
    messages: getThread(id, limit),
  };
  res.json(body);
});

// ---- Command handling ------------------------------------------------------

async function handleCommand(cmd: ClientCommand): Promise<void> {
  if (cmd.type === 'open-session') {
    setActiveConversation(cmd.conversationId);
    // Re-broadcast sessions so unread counts reset visually for everyone.
    hub.broadcast({ type: 'sessions-snapshot', sessions: listSessions() });
    return;
  }
  if (cmd.type === 'send-text') {
    await sendText(cmd.conversationId, cmd.text);
    return;
  }
  if (cmd.type === 'request-image') {
    await fetchImage(cmd.messageId);
    return;
  }
}

async function sendText(conversationId: string, text: string): Promise<void> {
  console.log(`[send] request conv=${conversationId} text=${JSON.stringify(text.slice(0, 40))}`);
  const wechaty = await getWechaty();
  let room;
  try {
    room = await wechaty.Room.find({ id: conversationId });
  } catch (err) {
    console.error('[send] Room.find threw:', (err as Error).message);
    room = null;
  }
  if (room) {
    try {
      await room.say(text);
      console.log(`[send] room.say ok conv=${conversationId}`);
      return;
    } catch (err) {
      const e = err as Error & { code?: number; details?: string };
      console.error('[send] room.say failed conv=' + conversationId,
        'code=', e.code, 'msg=', e.message, 'details=', e.details);
      throw err;
    }
  }
  let contact;
  try {
    contact = await wechaty.Contact.find({ id: conversationId });
  } catch (err) {
    console.error('[send] Contact.find threw:', (err as Error).message);
    contact = null;
  }
  if (contact) {
    try {
      await contact.say(text);
      console.log(`[send] contact.say ok conv=${conversationId}`);
      return;
    } catch (err) {
      const e = err as Error & { code?: number; details?: string };
      console.error('[send] contact.say failed conv=' + conversationId,
        'code=', e.code, 'msg=', e.message, 'details=', e.details);
      throw err;
    }
  }
  console.error(`[send] unknown conversation id: ${conversationId}`);
  throw new Error(`unknown conversation id: ${conversationId}`);
}

async function fetchImage(messageId: string): Promise<void> {
  console.log('[image] fetch request for', messageId);
  const cached = getCached(messageId);
  if (cached) {
    console.log('[image] cache hit for', messageId);
    const updated = patchMessageImage(messageId, cached);
    if (updated) hub.broadcast({ type: 'image-ready', messageId, imageDataUrl: cached });
    return;
  }
  const wechaty = await getWechaty();
  let msg;
  try {
    msg = await wechaty.Message.find({ id: messageId });
  } catch (err) {
    console.error('[image] Message.find failed for', messageId, ':', (err as Error).message);
    return;
  }
  if (!msg) {
    console.warn('[image] Message.find returned null for', messageId, '— message id may have aged out of gateway LRU');
    return;
  }
  if (msg.type() !== wechaty.Message.Type.Image) {
    console.warn('[image] not an image message:', messageId, 'type=', msg.type());
    return;
  }
  try {
    const fb = await msg.toImage().thumbnail();
    const buf = await fb.toBuffer();
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    console.log('[image] fetched', messageId, `(${buf.length}B)`);
    setCached(messageId, dataUrl);
    patchMessageImage(messageId, dataUrl);
    hub.broadcast({ type: 'image-ready', messageId, imageDataUrl: dataUrl });
  } catch (err) {
    const e = err as Error & { code?: number; details?: string };
    console.error('[image] toImage/thumbnail/toBuffer failed for', messageId,
      'code=', e.code, 'message=', e.message, 'details=', e.details);
  }
}

// ---- Wechaty wiring --------------------------------------------------------

async function bootstrapWechaty(): Promise<void> {
  const wechaty = await getWechaty();
  wechaty.on('message', async (msg: Message) => {
    try {
      const ref = await resolveConversation(msg);
      if (!ref) return;
      const record = makeRecord(msg, ref, wechaty);
      const session = ingest(ref, record);
      const evt: ServerEvent = { type: 'message', message: record, session };
      hub.broadcast(evt);
    } catch (err) {
      console.error('[server] message handler error:', err);
    }
  });
  // Backfill member counts for cached rooms so the chat header shows "(N)"
  // even before any new message arrives. Runs once login is established.
  wechaty.on('login', async () => {
    try {
      await backfillRoomMemberCounts(async (roomId) => {
        const room = await wechaty.Room.find({ id: roomId }).catch(() => null);
        if (!room) return undefined;
        const members = await room.memberAll().catch(() => undefined);
        return members?.length;
      });
      hub.broadcast({ type: 'sessions-snapshot', sessions: listSessions() });
    } catch (err) {
      console.error('[server] member-count backfill failed:', err);
    }
  });
}

// ---- HTTP server boot ------------------------------------------------------

// Hydrate sessions from the on-disk cache before wechaty connects. Standard
// wechaty pattern: sessions are accumulated client-side from `on('message')`
// (the puppet protocol is stateless), so we persist between runs ourselves.
// First-ever launch sees no cache file → starts empty, fills in as messages
// arrive. Second launch onward → sidebar populated within ms.
const hydrate = loadCache();
console.log(
  `[sessions] cache: ${
    hydrate.loaded
      ? `loaded ${hydrate.sessionCount} sessions`
      : 'no cache (first launch — sessions will populate as messages arrive)'
  }`,
);

const server = http.createServer(app);
hub.attach(server);

server.listen(PORT, HOST, () => {
  console.log(`[server] http listening on http://${HOST}:${PORT}`);
  console.log(`[server] ws upgrade path: ws://${HOST}:${PORT}/ws`);
});

bootstrapWechaty().catch((err) => {
  console.error('[server] wechaty bootstrap failed (server still up):', err);
  // Surface to UIs that connect later.
});

// Graceful shutdown — flush cache, then close server.
function shutdown(signal: string) {
  console.log(`[server] received ${signal}, flushing cache + shutting down`);
  flushCacheSync();
  server.close(() => process.exit(0));
  // Hard-exit fallback in case server.close hangs on stuck WS clients.
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('beforeExit', () => flushCacheSync());
