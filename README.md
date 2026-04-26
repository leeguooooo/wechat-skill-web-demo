# wechat-skill-web-demo

A small web-based WeChat-clone demo that talks to the
[`wechat-skill`](https://github.com/leeguooooo/wechat-skill) gateway through the
official **wechaty SDK** (`wechaty` + `wechaty-puppet-service`). Any wechaty
bot author can use this as a starting point for a browser UI on top of the
skill.

> Dev-only. Binds to `127.0.0.1` and has no auth. Put behind a reverse proxy
> with real auth before exposing it.

## Architecture

```
Browser (Svelte 5 SPA + Tailwind, vite dev server on :5173)
    │  fetch /api/*  ──┐
    │  WebSocket /ws ──┤  (vite proxy)
    ▼                  ▼
Node server (express + ws, :8787)
    │
    │  uses npm `wechaty` + `wechaty-puppet-service`
    ▼
wechat-wechaty-gateway (gRPC on 127.0.0.1:18401, managed separately)
    ▼
WeChat (macOS, run by the parent project)
```

The browser **never** speaks gRPC. The Node process is just a normal wechaty
bot that happens to publish its events to a websocket.

## How to run

1. Make sure your `wechat-wechaty-gateway` is up on `127.0.0.1:18401`.
2. `npm install`
3. `npm run dev`  *(starts vite on :5173 + node server on :8787)*
4. Open http://127.0.0.1:5173 in a browser.
5. The header should switch from "connecting…" to "logged in as <your name>".

## What it does

- Sessions panel (left): recent chats sorted by last activity, with unread
  badge, last-message preview (≤30 chars) and a hash-coloured initial avatar.
- Message thread (right): last 50 messages, self-sent right-aligned in green,
  inbound left-aligned in white, group messages prefixed with sender name.
- Image messages: rendered as thumbnails (`Message.toImage().thumbnail()`),
  cached in an LRU of 100 entries on the server.
- Live updates: server fans out wechaty `message` events over WebSocket.
- Send box: `Enter` sends. Optimistic local rendering, reconciled when the
  wechaty echo comes back.

## Configuration

Environment variables (all optional):

| Var | Default | Meaning |
|---|---|---|
| `WECHATY_GATEWAY_ENDPOINT` | `127.0.0.1:18401` | Gateway gRPC address. |
| `WECHATY_GATEWAY_TOKEN`    | `puppet_workpro_local` | Puppet token (placeholder; gateway doesn't enforce). |
| `PORT`                     | `8787`            | Local Node server port. |

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server + tsx-watched server. |
| `npm run build` | Build static client to `dist/` and compile server to `dist-server/`. |
| `npm start` | Run the compiled server (serves nothing static — pair with a static host or extend `index.ts`). |
| `npm run typecheck` | `tsc --noEmit` for both client and server projects. |

## Roadmap (deferred for v2)

- Sending images / files (gateway upload RPC unimplemented)
- Friend requests, room create / invite
- Message recall / forward / quote-reply
- Multi-account login
- Real auth + production deploy guide
- Voice playback

## Screenshot

*(placeholder — drop a screenshot at `docs/screenshot.png` once you have one)*
