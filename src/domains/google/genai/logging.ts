/**
 * GenAI activity-log types + payload redaction (privacy D3/GG-3).
 *
 * Log entries flow client → injected sink (wired to useGenAIStore.addLog at
 * the composition root). The store keeps them as an in-memory ring buffer
 * (`maxLogs`-capped); its partialize allowlist excludes `logs`, so they never
 * reach localStorage. Cross-restart persistence is the app layer's job
 * (app/google/genaiLogPersistence.ts mirrors the buffer into a side database).
 *
 * `redactPayload` strips `inlineData` base64 image bytes BEFORE the entry
 * ever leaves the client: table-adaptation prompts embed full-resolution
 * page screenshots, which must not be stored verbatim.
 */

export interface GenAILogEntry {
  id: string;
  timestamp: number;
  /**
   * `'debug'` is for high-volume, EXPECTED chatter that would otherwise crowd
   * the capped ring buffer — model rotation stepping past an exhausted model is
   * the motivating case: once the head of the rotation list has spent its daily
   * quota, every subsequent request steps over it, so logging those at `'error'`
   * evicted the entries worth reading within ~100 requests. `'error'` stays for
   * outcomes a human should act on.
   */
  type: 'request' | 'response' | 'error' | 'debug';
  method: string;
  payload: unknown;
  bookTitle?: string;
  sectionTitle?: string;
  correlationId?: string;
}

export type GenAILogSink = (entry: GenAILogEntry) => void;

/** Cheap stable content hash (FNV-1a, hex) — enough to correlate payloads. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function isInlineData(value: unknown): value is { data: string; mimeType?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { data?: unknown }).data === 'string'
  );
}

/**
 * Deep-copy `payload` with every `inlineData: { data: <base64>, … }` node
 * replaced by `{ byteCount, hash, mimeType }`. Everything else (prompt text,
 * schemas, parsed responses) passes through untouched — the prompt text is
 * the user's own book and stays useful for debugging; only the heavy image
 * bytes are dropped.
 */
export function redactPayload(payload: unknown, depth = 0): unknown {
  if (depth > 16 || payload === null || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) {
    return payload.map((item) => redactPayload(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (key === 'inlineData' && isInlineData(value)) {
      const base64 = value.data;
      out[key] = {
        // base64 → approximate decoded byte count.
        byteCount: Math.floor((base64.length * 3) / 4),
        hash: fnv1aHex(base64),
        mimeType: value.mimeType,
        redacted: true,
      };
    } else {
      out[key] = redactPayload(value, depth + 1);
    }
  }
  return out;
}
