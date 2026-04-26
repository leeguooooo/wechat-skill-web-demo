// Singleton wechaty client + reconnect logic.
//
// IMPORTANT: TLS env vars MUST be set BEFORE importing wechaty-puppet-service.
// We re-export `getWechaty()` which lazily constructs and starts the client.

process.env.WECHATY_PUPPET_SERVICE_NO_TLS_INSECURE_CLIENT ??= '1';
process.env.WECHATY_PUPPET_SERVICE_NO_TLS_INSECURE_SERVER ??= '1';

import { WechatyBuilder, type Wechaty } from 'wechaty';
import { PuppetService } from 'wechaty-puppet-service';
import type { LoginState } from '../shared/types.js';

const ENDPOINT = process.env.WECHATY_GATEWAY_ENDPOINT ?? '127.0.0.1:18401';
const TOKEN = process.env.WECHATY_GATEWAY_TOKEN ?? 'puppet_workpro_local';

export type LoginListener = (state: LoginState) => void;

let instance: Wechaty | null = null;
let starting: Promise<Wechaty> | null = null;
let currentState: LoginState = { status: 'connecting' };
const listeners = new Set<LoginListener>();

function setState(next: LoginState) {
  currentState = next;
  for (const fn of listeners) {
    try {
      fn(next);
    } catch (err) {
      console.error('[wechaty] login listener threw:', err);
    }
  }
}

export function getLoginState(): LoginState {
  return currentState;
}

export function onLoginStateChange(fn: LoginListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function buildPuppet() {
  return new PuppetService({
    token: TOKEN,
    endpoint: ENDPOINT,
    tls: { disable: true, serverName: 'localhost' },
  });
}

async function bootstrap(): Promise<Wechaty> {
  const puppet = buildPuppet();
  const wechaty = WechatyBuilder.build({ name: 'wechat-skill-web-demo', puppet });

  wechaty.on('login', (user) => {
    console.log('[wechaty] login:', user.id, user.name?.());
    setState({ status: 'logged-in', userId: user.id, userName: user.name?.() ?? user.id });
  });
  wechaty.on('logout', (user, reason) => {
    console.log('[wechaty] logout:', user.id, reason);
    setState({ status: 'logged-out' });
  });
  wechaty.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[wechaty] error:', message);
    // Don't kill the singleton — wechaty has its own retry loop. Just surface state.
    setState({ status: 'error', message });
  });
  wechaty.on('start', () => console.log('[wechaty] started'));
  wechaty.on('stop', () => {
    console.log('[wechaty] stopped — will attempt reconnect in 5s');
    setState({ status: 'reconnecting' });
    setTimeout(() => {
      // Allow any in-flight stop to settle before restarting.
      wechaty.start().catch((err) => {
        console.error('[wechaty] reconnect failed:', err);
      });
    }, 5_000);
  });

  await wechaty.start();
  return wechaty;
}

export function getWechaty(): Promise<Wechaty> {
  if (instance) return Promise.resolve(instance);
  if (starting) return starting;
  starting = bootstrap()
    .then((w) => {
      instance = w;
      starting = null;
      return w;
    })
    .catch((err) => {
      starting = null;
      const message = err instanceof Error ? err.message : String(err);
      setState({ status: 'error', message });
      throw err;
    });
  return starting;
}
