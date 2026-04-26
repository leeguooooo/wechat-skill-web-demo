// WebSocket broadcaster. Holds the set of connected browsers, fans out
// ServerEvent messages, and routes ClientCommand back to the wechaty side.

import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientCommand, ServerEvent } from '../shared/types.js';

export type CommandHandler = (cmd: ClientCommand, ws: WebSocket) => void | Promise<void>;
export type ConnectHandler = (ws: WebSocket) => void | Promise<void>;

export interface WsHub {
  attach: (server: import('node:http').Server) => void;
  broadcast: (evt: ServerEvent) => void;
  send: (ws: WebSocket, evt: ServerEvent) => void;
  clientCount: () => number;
}

export function createWsHub(opts: {
  onCommand: CommandHandler;
  onConnect: ConnectHandler;
}): WsHub {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('error', (err) => {
      console.error('[ws] client error:', err);
      clients.delete(ws);
    });
    ws.on('message', async (raw) => {
      let cmd: ClientCommand;
      try {
        cmd = JSON.parse(raw.toString()) as ClientCommand;
      } catch {
        return;
      }
      try {
        await opts.onCommand(cmd, ws);
      } catch (err) {
        console.error('[ws] command handler threw:', err);
        send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) });
      }
    });
    void opts.onConnect(ws);
  });

  function send(ws: WebSocket, evt: ServerEvent) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(evt));
  }

  function broadcast(evt: ServerEvent) {
    const payload = JSON.stringify(evt);
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(payload);
    }
  }

  function attach(server: import('node:http').Server) {
    server.on('upgrade', (req: IncomingMessage, socket, head) => {
      if (req.url && req.url.startsWith('/ws')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });
  }

  return { attach, broadcast, send, clientCount: () => clients.size };
}
