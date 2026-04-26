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
  const text = kind === 'text' ? (msg.text() || '') : placeholderText(kind);
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
