// Bridge between wechaty Message instances and our wire-format MessageRecord.
//
// We intentionally do NOT pre-fetch image bytes here — toBuffer() is expensive
// and may fail on the gateway. Image thumbnails are fetched lazily via the
// `request-image` WS command.

import type { Message, Wechaty } from 'wechaty';
import type {
  ConversationKind,
  MessageDisplayKind,
  MessageRecord,
} from '../shared/types.js';
import type { ConversationRef } from './sessions.js';

function classify(msg: Message, wechaty: Wechaty): MessageDisplayKind {
  const T = wechaty.Message.Type;
  switch (msg.type()) {
    case T.Text:
      return 'text';
    case T.Image:
      return 'image';
    case T.Video:
      return 'video';
    case T.Audio:
      return 'audio';
    case T.Attachment:
      return 'file';
    default:
      return 'other';
  }
}

function placeholderText(kind: MessageDisplayKind): string {
  switch (kind) {
    case 'image':
      return '[图片]';
    case 'video':
      return '[视频]';
    case 'audio':
      return '[语音]';
    case 'file':
      return '[文件]';
    case 'other':
      return '[消息]';
    default:
      return '';
  }
}

export async function resolveConversation(
  msg: Message,
): Promise<ConversationRef | null> {
  const room = msg.room();
  if (room) {
    const topic = await room.topic().catch(() => undefined);
    return {
      id: room.id,
      kind: 'room' as ConversationKind,
      displayName: topic || room.id,
    };
  }
  // DM: conversation id is the *counterparty* contact, not the self id.
  const talker = msg.talker();
  const listener = msg.listener();
  let other = talker;
  if (msg.self() && listener) other = listener;
  if (!other) return null;
  return {
    id: other.id,
    kind: 'dm' as ConversationKind,
    displayName: other.name() || other.id,
  };
}

export function makeRecord(
  msg: Message,
  ref: ConversationRef,
  wechaty: Wechaty,
): MessageRecord {
  const kind = classify(msg, wechaty);
  const isSelf = msg.self();
  const talker = msg.talker();
  const senderName = talker?.name() || talker?.id || (isSelf ? 'Me' : 'Unknown');
  // Text resolution priority:
  //   1. msg.text() if non-empty AND not a raw XML payload — wechaty exposes
  //      our gateway's `display_text` field (daemon classifier already
  //      extracted titles for url / miniprogram / appmsg / system). For
  //      `text` kind this IS the body. For `url` / `mini_program` / `system`
  //      it's the human-readable title — much better than "[消息]".
  //   2. `[图片] / [视频] / [语音] / [文件]` placeholder for binary kinds
  //      where the user clicks to fetch the actual bytes via WS.
  //   3. "[消息]" as last-resort for genuinely opaque content.
  // Raw XML check: WeChat's appmsg/sysmsg messages start with `<` when
  // unparsed; we never want those in the UI bubble.
  const rawText = (msg.text() || '').trim();
  const isXml = rawText.startsWith('<');
  let text: string;
  if (rawText && !isXml) {
    text = rawText;
  } else if (kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'file') {
    // Binary kinds: keep the type placeholder so UI knows to render
    // the "tap to load" affordance instead of dumping XML.
    text = placeholderText(kind);
  } else {
    // text kind with empty body, or rich kind with no extractable title.
    text = placeholderText(kind);
  }
  return {
    id: msg.id,
    conversationId: ref.id,
    conversationKind: ref.kind,
    senderName,
    self: isSelf,
    kind,
    text,
    ts: msg.date()?.getTime?.() ?? Date.now(),
  };
}
