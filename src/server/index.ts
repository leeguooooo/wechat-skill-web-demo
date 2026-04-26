// Entry point: HTTP REST endpoints + WebSocket upgrade + wechaty wiring.

import http from 'node:http';
import express from 'express';
import type { Request, Response } from 'express';
import type { Message } from 'wechaty';
import { getWechaty, getLoginState, onLoginStateChange } from './wechaty.js';
import {
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
    await handleCommand(cmd);
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
  const wechaty = await getWechaty();
  // Try room first, then contact. wechaty's load() returns a stub regardless,
  // so we need to disambiguate by attempting Room.find / Contact.find.
  const room = await wechaty.Room.find({ id: conversationId }).catch(() => null);
  if (room) {
    await room.say(text);
    return;
  }
  const contact = await wechaty.Contact.find({ id: conversationId }).catch(() => null);
  if (contact) {
    await contact.say(text);
    return;
  }
  throw new Error(`unknown conversation id: ${conversationId}`);
}

async function fetchImage(messageId: string): Promise<void> {
  const cached = getCached(messageId);
  if (cached) {
    const updated = patchMessageImage(messageId, cached);
    if (updated) hub.broadcast({ type: 'image-ready', messageId, imageDataUrl: cached });
    return;
  }
  const wechaty = await getWechaty();
  const msg = await wechaty.Message.find({ id: messageId }).catch(() => null);
  if (!msg) return;
  if (msg.type() !== wechaty.Message.Type.Image) return;
  try {
    const fb = await msg.toImage().thumbnail();
    const buf = await fb.toBuffer();
    const dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
    setCached(messageId, dataUrl);
    patchMessageImage(messageId, dataUrl);
    hub.broadcast({ type: 'image-ready', messageId, imageDataUrl: dataUrl });
  } catch (err) {
    console.error('[server] image fetch failed for', messageId, err);
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
