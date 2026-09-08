/**
 * GenAI activity-log replay — evaluate an exported log ("Download GenAI
 * logs" in the GenAI settings tab) against the CURRENT code's policies.
 *
 * The export is the record of what the app sent and what came back. This
 * module rebuilds each reference-detection attempt from it (the prompt's
 * `Groups` array is the exact node list the validator saw) and asks the real
 * `validateReferenceDetection` what it would do with every logged answer, and
 * counts what the current policies avoid: model calls for tiny sections,
 * re-sends of rejected answers, same-instant request pairs, silent failures,
 * and the embedding retry patterns that could never succeed.
 *
 * Run it on a real export with
 *   GENAI_LOG_PATH=/path/to/genai_logs.txt npx vitest run src/test/replay
 * (optionally GENAI_REPLAY_OUT=/path/report.json). It is a dev tool: the
 * synthetic fixture in the sibling test keeps the parser and metrics honest
 * in CI; the real-export run is skipped when the env var is absent.
 */
import { GENAI_ROTATION_MODELS } from '@domains/google/genai/GeminiClient';
import {
  validateReferenceDetection,
  type ReferenceDetectionNode,
} from '@domains/google/genai/features/referenceDetection';
import { parseQuotaSignals } from '@domains/google/genai/quotaSignals';
import { MAX_GROUPS_FOR_DETERMINISTIC_ONLY } from '@lib/tts/ReferenceSectionDetector';
import { DEFAULT_QUOTA_LIMITS } from '@store/useGenAIStore';
import { ptDayString } from '@kernel/quota';

type ExportEntryType = 'REQUEST' | 'RESPONSE' | 'ERROR' | 'DEBUG';

export interface ExportEntry {
  index: number;
  timestamp: number;
  type: ExportEntryType;
  method: string;
  correlationId?: string;
  bookTitle?: string;
  sectionTitle?: string;
  payload: unknown;
}

const HEADER_RE =
  /^\[(\d{4}-\d\d-\d\dT[\d:.]+Z)\] (REQUEST|RESPONSE|ERROR|DEBUG) \(([\w-]+)\)(?: cid=(\S+))?(?: book=("(?:[^"\\]|\\.)*"))?(?: section=("(?:[^"\\]|\\.)*"))?\s*$/;
const SEPARATOR_RE = /^-{40}\s*$/;

/** Parse the text of a "Download GenAI logs" export into entries (chronological as exported). */
export function parseGenAILogExport(text: string): ExportEntry[] {
  const entries: ExportEntry[] = [];
  let current: Omit<ExportEntry, 'payload'> | null = null;
  let body: string[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    const header: RegExpExecArray | null = current === null ? HEADER_RE.exec(line) : null;
    if (header) {
      current = {
        index: entries.length,
        timestamp: Date.parse(header[1]),
        type: header[2] as ExportEntryType,
        method: header[3],
        correlationId: header[4],
        bookTitle: header[5] ? (JSON.parse(header[5]) as string) : undefined,
        sectionTitle: header[6] ? (JSON.parse(header[6]) as string) : undefined,
      };
      body = [];
      continue;
    }
    if (current !== null && SEPARATOR_RE.test(line)) {
      const raw = body.join('\n');
      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch {
        payload = raw;
      }
      entries.push({ ...current, payload });
      current = null;
      body = [];
      continue;
    }
    if (current !== null) body.push(line);
  }
  return entries;
}

/** FNV-1a over the prompt text: cheap identity for "the same section, same input". */
function promptHash(prompt: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < prompt.length; i++) {
    hash ^= prompt.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** The node list the validator saw, rebuilt from the prompt's trailing `Groups:` JSON. */
export function nodesFromPrompt(prompt: string): ReferenceDetectionNode[] | null {
  const at = prompt.lastIndexOf('Groups:\n');
  if (at < 0) return null;
  try {
    const groups = JSON.parse(prompt.slice(at + 'Groups:\n'.length)) as {
      id: number;
      sampleText: string;
      leadsWithMarker?: boolean;
    }[];
    return groups.map((g) => ({
      id: String(g.id),
      sampleText: g.sampleText,
      ...(g.leadsWithMarker ? { leadsWithMarker: true } : {}),
    }));
  } catch {
    return null;
  }
}

type AttemptOutcome = 'accepted' | 'rejected' | 'silent';

interface DetectionAttempt {
  /** Index of the first request entry of this attempt. */
  entryIndex: number;
  timestamp: number;
  /** Models tried, in order (more than one = rotation within the attempt). */
  models: string[];
  promptHash: string;
  nodes: ReferenceDetectionNode[] | null;
  groupCount: number | null;
  outcome: AttemptOutcome;
  /** The model's answer (accepted) or the rejected index (rejected). */
  referenceStartIndex?: number;
  responseParsed?: unknown;
  rejectionError?: string;
}

/** Requests of the same prompt within this window with no outcome between are one attempt (rotation). */
const ROTATION_WINDOW_MS = 120_000;
const REJECTED_INDEX_RE = /referenceStartIndex (-?\d+) is (?:before 40% of chapter|outside) .*?\((\d+) groups\)/;

/**
 * Rebuild the reference-detection attempts. Entries written by the current
 * client carry a correlation id and pair exactly; older entries pair by the
 * prompt hash (rotation) and by group count (the telemetry record that
 * follows a response, or the "(N groups)" in a validation error).
 */
function reconstructDetectionAttempts(entries: ExportEntry[]): DetectionAttempt[] {
  const attempts: DetectionAttempt[] = [];
  const open: DetectionAttempt[] = [];
  const byCid = new Map<string, DetectionAttempt>();
  const close = (attempt: DetectionAttempt, outcome: AttemptOutcome): void => {
    attempt.outcome = outcome;
    const i = open.indexOf(attempt);
    if (i >= 0) open.splice(i, 1);
  };

  for (const entry of entries) {
    if (entry.method !== 'detectContentTypes' && entry.method !== 'detectReferenceStart') continue;
    const payload = (entry.payload ?? {}) as Record<string, unknown>;

    if (entry.type === 'REQUEST' && entry.method === 'detectContentTypes') {
      const prompt = typeof payload.prompt === 'string' ? payload.prompt : JSON.stringify(payload.prompt);
      const hash = promptHash(prompt);
      const model = String(payload.model ?? '?');
      const rotation = entry.correlationId
        ? byCid.get(entry.correlationId)
        : open.find((a) => a.promptHash === hash && entry.timestamp - a.timestamp <= ROTATION_WINDOW_MS);
      if (rotation && rotation.outcome === 'silent' && open.includes(rotation)) {
        rotation.models.push(model);
        continue;
      }
      // An older open attempt for the same prompt is a silent failure now being retried.
      for (const stale of open.filter((a) => a.promptHash === hash)) close(stale, 'silent');
      const nodes = nodesFromPrompt(prompt);
      const attempt: DetectionAttempt = {
        entryIndex: entry.index,
        timestamp: entry.timestamp,
        models: [model],
        promptHash: hash,
        nodes,
        groupCount: nodes ? nodes.length : null,
        outcome: 'silent',
      };
      attempts.push(attempt);
      open.push(attempt);
      if (entry.correlationId) byCid.set(entry.correlationId, attempt);
      continue;
    }

    if (entry.type === 'RESPONSE' && entry.method === 'detectContentTypes') {
      const parsed = payload.parsed as { referenceStartIndex?: number; justification?: string } | undefined;
      let attempt = entry.correlationId ? byCid.get(entry.correlationId) : undefined;
      if (!attempt) {
        // The telemetry record follows within a few entries and names the group count.
        let groupCount: number | undefined;
        for (let j = entry.index + 1; j < Math.min(entries.length, entry.index + 6); j++) {
          const next = entries[j];
          const np = (next.payload ?? {}) as Record<string, unknown>;
          if (next.method === 'detectReferenceStart' && np.justification === parsed?.justification) {
            groupCount = typeof np.groupCount === 'number' ? np.groupCount : undefined;
            break;
          }
        }
        const candidates = open.filter((a) => groupCount === undefined || a.groupCount === groupCount);
        attempt = (candidates.length > 0 ? candidates : open)[Math.max(0, (candidates.length > 0 ? candidates : open).length - 1)];
      }
      if (!attempt) continue;
      attempt.responseParsed = parsed;
      attempt.referenceStartIndex = parsed?.referenceStartIndex;
      close(attempt, 'accepted');
      continue;
    }

    if ((entry.type === 'ERROR' || entry.type === 'DEBUG') && entry.method === 'detectContentTypes') {
      const message = String(payload.message ?? '');
      if (message === 'Response failed validation') {
        const error = String(payload.error ?? '');
        const m = REJECTED_INDEX_RE.exec(error);
        let attempt = entry.correlationId ? byCid.get(entry.correlationId) : undefined;
        if (!attempt) {
          const groupCount = m ? Number(m[2]) : undefined;
          const candidates = open.filter((a) => groupCount === undefined || a.groupCount === groupCount);
          const pool = candidates.length > 0 ? candidates : open;
          attempt = pool[pool.length - 1];
        }
        if (!attempt) continue;
        attempt.rejectionError = error;
        attempt.referenceStartIndex = m ? Number(m[1]) : undefined;
        close(attempt, 'rejected');
      } else if (message.startsWith('Request failed') || message.startsWith('All ')) {
        // The current client's terminal-failure entries: the attempt is closed
        // with a reason, which the old client never wrote.
        const attempt = entry.correlationId ? byCid.get(entry.correlationId) : open[open.length - 1];
        if (attempt) close(attempt, 'silent');
      }
    }
  }
  return attempts;
}

interface EmbeddingErrorCluster {
  /** Midnight-Pacific day key. */
  day: string;
  count: number;
  status: number | undefined;
  kind: 'daily-quota' | 'per-minute' | 'unavailable' | 'other';
  firstAt: number;
  lastAt: number;
  /** The first error's message (the server hint, if any, is parsed from it). */
  message: string;
  /** Seconds between consecutive errors in the cluster. */
  spacingS: number[];
  /** Requests the current policy would have spent on this cluster (see the notes). */
  requestsUnderPolicy: number;
}

export interface ReplayReport {
  entries: number;
  from: string;
  to: string;
  detection: {
    requests: number;
    attempts: number;
    uniqueSections: number;
    outcomes: Record<AttemptOutcome, number>;
    /** What the CURRENT validator says about every logged answer. */
    validator: {
      acceptedBefore: number;
      acceptedAfter: number;
      rejectedBefore: number;
      rejectedAfterOfThose: number;
      newlyRejected: number;
      rejectedCases: { at: string; groupCount: number; index: number; headText: string; acceptedNow: boolean }[];
    };
    tinySectionRequests: number;
    tinySections: number;
    rejectedResends: number;
    sameInstantRequests: number;
    requestsAfter: number;
    quota: {
      maxRequestsPerPtDay: number;
      ptDaysOverHeadModel: number;
      headModelRpd: number;
      rotationCapacityRpd: number;
      ptDaysOverRotationCapacity: number;
    };
  };
  embedding: {
    errors: number;
    clusters: EmbeddingErrorCluster[];
    requestsObserved: number;
    requestsUnderPolicy: number;
    notes: string[];
  };
  tables: {
    requests: number;
    responses: number;
    emptyMimeRequests: number;
    narrationsByText: { cfi: string; looksLikeTable: boolean; head: string }[];
  };
}

/** Policy constants mirrored from EmbeddingIndexer (inline backoff) and the reader scheduler. */
const POLICY = {
  inlineRetries: 4,
  defaultCooldownMs: 30_000,
  schedulerRetryMs: 90_000,
};

/** Requests one indexer pass + scheduler cadence spends inside a busy-minute cluster. */
function simulateMinuteBurst(durationS: number, waitS: number): number {
  let t = 0;
  let requests = 0;
  while (t <= durationS) {
    // One pass: the first request plus up to `inlineRetries` retries, each after the cooldown.
    for (let attempt = 0; attempt <= POLICY.inlineRetries && t <= durationS; attempt++) {
      requests += 1;
      t += waitS;
    }
    t += POLICY.schedulerRetryMs / 1000;
  }
  return requests;
}

function classifyEmbeddingError(message: string, status: number | undefined): EmbeddingErrorCluster['kind'] {
  if (status === 503) return 'unavailable';
  if (/_free_tier_requests, limit: \d+/.test(message) || /per[\s_-]?day/i.test(message)) return 'daily-quota';
  if (status === 429) return 'per-minute';
  return 'other';
}

export function replayGenAILog(entries: ExportEntry[]): ReplayReport {
  const attempts = reconstructDetectionAttempts(entries);
  const requests = entries.filter((e) => e.type === 'REQUEST' && e.method === 'detectContentTypes');

  // --- validator replay ---------------------------------------------------
  let acceptedAfter = 0;
  let newlyRejected = 0;
  let rejectedAfterOfThose = 0;
  const rejectedCases: ReplayReport['detection']['validator']['rejectedCases'] = [];
  for (const a of attempts) {
    if (!a.nodes) continue;
    if (a.outcome === 'accepted') {
      try {
        validateReferenceDetection(a.responseParsed, a.nodes);
        acceptedAfter += 1;
      } catch {
        newlyRejected += 1;
      }
    } else if (a.outcome === 'rejected' && a.referenceStartIndex !== undefined) {
      const raw = { justification: '(rejected before the raw text was logged)', referenceStartIndex: a.referenceStartIndex };
      let acceptedNow = true;
      try {
        validateReferenceDetection(raw, a.nodes);
      } catch {
        acceptedNow = false;
        rejectedAfterOfThose += 1;
      }
      rejectedCases.push({
        at: new Date(a.timestamp).toISOString(),
        groupCount: a.nodes.length,
        index: a.referenceStartIndex,
        headText: a.nodes[a.referenceStartIndex]?.sampleText.slice(0, 60) ?? '',
        acceptedNow,
      });
    }
  }
  const outcomes: Record<AttemptOutcome, number> = { accepted: 0, rejected: 0, silent: 0 };
  for (const a of attempts) outcomes[a.outcome] += 1;

  // --- avoided requests ---------------------------------------------------
  const tiny = attempts.filter((a) => a.groupCount !== null && a.groupCount <= MAX_GROUPS_FOR_DETERMINISTIC_ONLY);
  const tinyRequests = tiny.reduce((n, a) => n + a.models.length, 0);
  const rejectedHashes = new Set<string>();
  let rejectedResends = 0;
  for (const a of attempts) {
    if (rejectedHashes.has(a.promptHash)) rejectedResends += a.models.length;
    if (a.outcome === 'rejected') rejectedHashes.add(a.promptHash);
  }
  let sameInstant = 0;
  for (let i = 1; i < requests.length; i++) {
    if (requests[i].timestamp - requests[i - 1].timestamp <= 1000) sameInstant += 1;
  }

  // --- quota fit ----------------------------------------------------------
  const perDay = new Map<string, number>();
  for (const r of requests) {
    const day = ptDayString(r.timestamp);
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  const headModelRpd = DEFAULT_QUOTA_LIMITS[GENAI_ROTATION_MODELS[0]]?.rpd ?? 0;
  const rotationCapacityRpd = GENAI_ROTATION_MODELS.reduce((n, m) => n + (DEFAULT_QUOTA_LIMITS[m]?.rpd ?? 0), 0);
  const counts = [...perDay.values()];

  // --- embedding ----------------------------------------------------------
  const embedErrors = entries.filter((e) => e.type === 'ERROR' && (e.method === 'embedOne' || e.method === 'embedBatch'));
  const clusters: EmbeddingErrorCluster[] = [];
  for (const e of embedErrors) {
    const p = (e.payload ?? {}) as { message?: string; status?: number };
    const message = String(p.message ?? '');
    const day = ptDayString(e.timestamp);
    const kind = classifyEmbeddingError(message, p.status);
    const last = clusters[clusters.length - 1];
    if (last && last.day === day && last.kind === kind && e.timestamp - last.lastAt <= 15 * 60_000) {
      last.spacingS.push(Math.round((e.timestamp - last.lastAt) / 1000));
      last.count += 1;
      last.lastAt = e.timestamp;
    } else {
      clusters.push({
        day,
        count: 1,
        status: p.status,
        kind,
        firstAt: e.timestamp,
        lastAt: e.timestamp,
        message,
        spacingS: [],
        requestsUnderPolicy: 0,
      });
    }
  }
  const notes: string[] = [];
  for (const c of clusters) {
    const durationS = (c.lastAt - c.firstAt) / 1000;
    if (c.kind === 'daily-quota') {
      c.requestsUnderPolicy = 1;
    } else if (c.kind === 'per-minute') {
      // The server's own hint when the message carries one ("retry in Ns"), else the default cooldown.
      const hintMs = parseQuotaSignals({ error: { message: c.message } }).retryAfterMs ?? POLICY.defaultCooldownMs;
      c.requestsUnderPolicy = Math.min(c.count, simulateMinuteBurst(durationS, hintMs / 1000));
    } else {
      c.requestsUnderPolicy = c.count;
    }
  }
  notes.push(
    'daily-quota: one request per Pacific day — the first 429 cools the pool down until the next midnight PT (assumes the QuotaFailure detail names a PerDay quota, as the metric text implies).',
    'per-minute: at most 5 requests per indexer pass, spaced by the server hint or the 30 s default, then a 90 s scheduler wait.',
    'unavailable (503) and other: unchanged; the error is now logged with model, dims and lane.',
  );

  // --- tables ---------------------------------------------------------------
  const tableRequests = entries.filter((e) => e.type === 'REQUEST' && e.method === 'generateTableAdaptations');
  const tableResponses = entries.filter((e) => e.type === 'RESPONSE' && e.method === 'generateTableAdaptations');
  let emptyMime = 0;
  for (const r of tableRequests) {
    const parts = ((r.payload as { prompt?: { contents?: { parts?: unknown[] }[] } }).prompt?.contents?.[0]?.parts ?? []) as {
      inlineData?: { mimeType?: string };
    }[];
    if (parts.some((p) => p.inlineData && !p.inlineData.mimeType)) emptyMime += 1;
  }
  const narrations: ReplayReport['tables']['narrationsByText'] = [];
  for (const r of tableResponses) {
    const parsed = ((r.payload as { parsed?: { cfi: string; adaptation: string }[] }).parsed ?? []);
    for (const item of parsed) {
      const head = item.adaptation.slice(0, 80);
      narrations.push({
        cfi: item.cfi,
        looksLikeTable: /\b(table|row|column|cell|definition)\b/i.test(item.adaptation) && !/^(an illustration|index section|social media)/i.test(item.adaptation),
        head,
      });
    }
  }

  const uniqueSections = new Set(attempts.map((a) => a.promptHash)).size;
  return {
    entries: entries.length,
    from: entries.length ? new Date(entries[0].timestamp).toISOString() : '',
    to: entries.length ? new Date(entries[entries.length - 1].timestamp).toISOString() : '',
    detection: {
      requests: requests.length,
      attempts: attempts.length,
      uniqueSections,
      outcomes,
      validator: {
        acceptedBefore: outcomes.accepted,
        acceptedAfter,
        rejectedBefore: outcomes.rejected,
        rejectedAfterOfThose,
        newlyRejected,
        rejectedCases,
      },
      tinySectionRequests: tinyRequests,
      tinySections: new Set(tiny.map((a) => a.promptHash)).size,
      rejectedResends,
      sameInstantRequests: sameInstant,
      requestsAfter: requests.length - tinyRequests - rejectedResends,
      quota: {
        maxRequestsPerPtDay: counts.length ? Math.max(...counts) : 0,
        ptDaysOverHeadModel: counts.filter((n) => n > headModelRpd).length,
        headModelRpd,
        rotationCapacityRpd,
        ptDaysOverRotationCapacity: counts.filter((n) => n > rotationCapacityRpd).length,
      },
    },
    embedding: {
      errors: embedErrors.length,
      clusters,
      requestsObserved: embedErrors.length,
      requestsUnderPolicy: clusters.reduce((n, c) => n + c.requestsUnderPolicy, 0),
      notes,
    },
    tables: {
      requests: tableRequests.length,
      responses: tableResponses.length,
      emptyMimeRequests: emptyMime,
      narrationsByText: narrations,
    },
  };
}

/** A compact, human-readable rendering of the report (what the test prints). */
export function formatReplayReport(r: ReplayReport): string {
  const d = r.detection;
  const lines = [
    `GenAI log replay — ${r.entries} entries, ${r.from} → ${r.to}`,
    '',
    'Reference detection',
    `  requests sent ............... ${d.requests} (${d.attempts} attempts, ${d.uniqueSections} distinct sections)`,
    `  outcomes before ............. accepted ${d.outcomes.accepted}, rejected ${d.outcomes.rejected}, no logged outcome ${d.outcomes.silent}`,
    `  validator now ............... accepts ${d.validator.acceptedAfter}/${d.validator.acceptedBefore} previously accepted, ${d.validator.rejectedBefore - d.validator.rejectedAfterOfThose}/${d.validator.rejectedBefore} previously rejected; newly rejected ${d.validator.newlyRejected}`,
    ...d.validator.rejectedCases.map(
      (c) => `    ${c.at}  index ${c.index} of ${c.groupCount}  "${c.headText}"  → ${c.acceptedNow ? 'ACCEPTED' : 'still rejected'}`,
    ),
    `  tiny-section requests ....... ${d.tinySectionRequests} (${d.tinySections} sections) — now answered locally`,
    `  re-sends of rejected answers  ${d.rejectedResends} — now terminal after the first answer`,
    `  same-instant request pairs .. ${d.sameInstantRequests} requests within 1 s of another — now serialized`,
    `  requests after .............. ${d.requestsAfter} (${((1 - d.requestsAfter / Math.max(1, d.requests)) * 100).toFixed(0)}% fewer)`,
    `  silent failures ............. ${d.outcomes.silent} — every one now leaves an error entry`,
    `  busiest PT day .............. ${d.quota.maxRequestsPerPtDay} requests; ${d.quota.ptDaysOverHeadModel} days over the ${d.quota.headModelRpd}/day head model, ${d.quota.ptDaysOverRotationCapacity} over the ${d.quota.rotationCapacityRpd}/day rotation capacity`,
    '',
    'Embedding',
    `  errors ...................... ${r.embedding.errors} in ${r.embedding.clusters.length} clusters; requests under the new policy ${r.embedding.requestsUnderPolicy} vs ${r.embedding.requestsObserved} observed`,
    ...r.embedding.clusters.map(
      (c) => `    ${c.day}  ${c.kind.padEnd(12)} ×${c.count}  spacing s [${c.spacingS.join(', ')}]  → ${c.requestsUnderPolicy}`,
    ),
    ...r.embedding.notes.map((n) => `  note: ${n}`),
    '',
    'Table adaptation',
    `  requests ${r.tables.requests}, responses ${r.tables.responses}, requests with an empty image MIME type ${r.tables.emptyMimeRequests} (failed silently; now logged)`,
    ...r.tables.narrationsByText.map((n) => `    ${n.looksLikeTable ? 'table    ' : 'NOT table'} ${n.cfi}  ${JSON.stringify(n.head)}`),
  ];
  return lines.join('\n');
}
