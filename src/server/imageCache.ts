// Simple LRU for image thumbnail data URLs, keyed by message id.
// Cap = 100 entries. Insertion-order Map => oldest is the first key.

const CAP = 100;
const cache = new Map<string, string>();

export function getCached(messageId: string): string | undefined {
  const v = cache.get(messageId);
  if (v !== undefined) {
    // bump recency
    cache.delete(messageId);
    cache.set(messageId, v);
  }
  return v;
}

export function setCached(messageId: string, dataUrl: string): void {
  if (cache.has(messageId)) cache.delete(messageId);
  cache.set(messageId, dataUrl);
  while (cache.size > CAP) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}
