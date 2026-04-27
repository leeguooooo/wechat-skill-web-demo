// Browser-side reactive state. Uses Svelte 5 runes via plain TS (in .svelte.ts
// files runes work directly; for plain .ts we use writable getters).
//
// Strategy: we expose a single `store` object whose fields are mutated; consumer
// .svelte components read these via `$state` proxies they create themselves.
// To keep this simple and framework-version-agnostic, we use a basic
// publish/subscribe pattern.

import type {
  ClientCommand,
  LoginState,
  MessageRecord,
  SessionSummary,
} from '$shared/types';

type Listener = () => void;

export interface ConnectionState {
  status: 'connecting' | 'open' | 'reconnecting' | 'closed';
}

class Store {
  loginState: LoginState = { status: 'connecting' };
  connection: ConnectionState = { status: 'connecting' };
  sessions: SessionSummary[] = [];
  activeId: string | null = null;
  // conversationId => messages
  threads: Map<string, MessageRecord[]> = new Map();
  // optimistic messages keyed by clientNonce, awaiting server echo
  pendingNonces: Set<string> = new Set();
  // Last seen "logged-in" user info, retained across transient gRPC errors
  // so we can recover the header label silently when wechaty reconnects.
  // Without this, a single RST_STREAM leaves the UI stuck displaying the
  // gRPC error string forever even though messages keep flowing.
  private lastGoodUser: { userId: string; userName: string } | null = null;

  private listeners = new Set<Listener>();
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }

  connect() {
    if (this.ws) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    this.connection = { status: 'connecting' };
    this.notify();

    ws.addEventListener('open', () => {
      this.connection = { status: 'open' };
      this.notify();
    });

    ws.addEventListener('message', (ev) => {
      try {
        const evt = JSON.parse(ev.data);
        this.handleEvent(evt);
      } catch (err) {
        console.error('[ws] bad message', err);
      }
    });

    const reschedule = () => {
      this.ws = null;
      this.connection = { status: 'reconnecting' };
      this.notify();
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 1500);
    };
    ws.addEventListener('close', reschedule);
    ws.addEventListener('error', () => {
      try {
        ws.close();
      } catch {}
    });
  }

  send(cmd: ClientCommand) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(cmd));
    }
  }

  async loadSessions() {
    try {
      const r = await fetch('/api/sessions');
      const body = await r.json();
      this.sessions = body.sessions ?? [];
      this.loginState = body.loginState ?? this.loginState;
      if (this.loginState.status === 'logged-in') {
        this.lastGoodUser = {
          userId: this.loginState.userId,
          userName: this.loginState.userName,
        };
      }
      this.notify();
    } catch (err) {
      console.error('[fetch] sessions failed', err);
    }
  }

  async openSession(id: string) {
    this.activeId = id;
    // Mark unread cleared locally for snappier feel.
    const found = this.sessions.find((s) => s.id === id);
    if (found) found.unread = 0;
    this.notify();
    this.send({ type: 'open-session', conversationId: id });
    if (!this.threads.has(id)) {
      try {
        const r = await fetch(`/api/threads/${encodeURIComponent(id)}?limit=50`);
        const body = await r.json();
        this.threads.set(id, body.messages ?? []);
        this.notify();
      } catch (err) {
        console.error('[fetch] thread failed', err);
      }
    }
  }

  sendText(conversationId: string, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const clientNonce = `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    // Optimistic insert
    const optimistic: MessageRecord = {
      id: clientNonce,
      conversationId,
      conversationKind:
        this.sessions.find((s) => s.id === conversationId)?.kind ?? 'dm',
      senderName: 'Me',
      self: true,
      kind: 'text',
      text: trimmed,
      ts: Date.now(),
    };
    const arr = this.threads.get(conversationId) ?? [];
    arr.push(optimistic);
    this.threads.set(conversationId, arr);
    this.pendingNonces.add(clientNonce);
    this.notify();

    this.send({ type: 'send-text', conversationId, text: trimmed, clientNonce });
  }

  requestImage(messageId: string) {
    this.send({ type: 'request-image', messageId });
  }

  private handleEvent(evt: any) {
    // Any non-error event means the wechaty pipeline is alive again — recover
    // a sticky 'error' loginState back to 'logged-in' using the last good
    // user info. Wechaty surfaces transient gRPC errors (e.g. RST_STREAM)
    // through `on('error')` even when the underlying stream auto-recovers,
    // so without this the header is stuck red forever.
    if (
      this.loginState.status === 'error' &&
      evt.type !== 'error' &&
      this.lastGoodUser
    ) {
      this.loginState = { status: 'logged-in', ...this.lastGoodUser };
    }
    switch (evt.type) {
      case 'login-state':
        this.loginState = evt.state;
        if (evt.state.status === 'logged-in') {
          this.lastGoodUser = {
            userId: evt.state.userId,
            userName: evt.state.userName,
          };
        }
        this.notify();
        break;
      case 'sessions-snapshot':
        this.sessions = evt.sessions;
        this.notify();
        break;
      case 'message': {
        const msg = evt.message as MessageRecord;
        // Update sessions: bring this conversation to front.
        const sIdx = this.sessions.findIndex((s) => s.id === evt.session.id);
        if (sIdx >= 0) this.sessions.splice(sIdx, 1);
        this.sessions.unshift(evt.session);
        // If active conversation, append to thread (de-dup on id, and try to
        // reconcile any optimistic message with same text/self).
        const arr = this.threads.get(msg.conversationId) ?? [];
        if (!arr.some((m) => m.id === msg.id)) {
          // Reconcile optimistic
          if (msg.self) {
            const pendingIdx = arr.findIndex(
              (m) =>
                m.self &&
                this.pendingNonces.has(m.id) &&
                m.text === msg.text,
            );
            if (pendingIdx >= 0) {
              this.pendingNonces.delete(arr[pendingIdx].id);
              arr.splice(pendingIdx, 1);
            }
          }
          arr.push(msg);
          this.threads.set(msg.conversationId, arr);
          if (msg.kind === 'image' && this.activeId === msg.conversationId) {
            // Eager prefetch when conversation is open.
            this.requestImage(msg.id);
          }
        }
        this.notify();
        break;
      }
      case 'image-ready': {
        for (const [cid, arr] of this.threads) {
          const m = arr.find((x) => x.id === evt.messageId);
          if (m) {
            m.imageDataUrl = evt.imageDataUrl;
            this.threads.set(cid, [...arr]);
          }
        }
        this.notify();
        break;
      }
      case 'error':
        console.warn('[server error]', evt.message);
        break;
    }
  }
}

export const store = new Store();
