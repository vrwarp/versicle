/**
 * Defines the available logging levels.
 */
type LogLevel = 'info' | 'warn' | 'error' | 'debug';

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

interface ImportMetaEnv {
  readonly VITE_LOG_LEVEL?: LogLevel;
  readonly DEV: boolean;
}

// Helper to access env safely (worker/node contexts may lack import.meta.env)
const getEnv = (): ImportMetaEnv => {
  return (import.meta as { env?: ImportMetaEnv }).env || { DEV: false };
};

const shouldLog = (level: LogLevel): boolean => {
  const env = getEnv();
  const configuredLevel = (env.VITE_LOG_LEVEL) || (env.DEV ? 'info' : 'warn');
  return LEVELS[level] >= LEVELS[configuredLevel];
};

// ─── Diagnostics ring buffer ────────────────────────────────────────────────
// Production builds print only warn+ (see shouldLog), which leaves nothing to
// look at when a user reports "sync isn't working" on a phone with no
// devtools attached. Every log call — printed or not — is ALSO appended to a
// small bounded in-memory ring that the sync-diagnostics export
// (src/app/sync/diagnostics) bundles. Cheap by construction: info/debug keep
// only the message string; warn/error additionally keep a truncated
// rendering of their args. Per JS realm (the TTS worker has its own ring).

export interface LogRecord {
  /** Wall clock (ms since epoch). */
  t: number;
  level: LogLevel;
  ns: string;
  msg: string;
  /** Truncated rendering of the extra args (warn/error only). */
  args?: string;
}

const LOG_RING_CAPACITY = 2000;
const ARGS_MAX_CHARS = 1000;
const logRing: LogRecord[] = [];
let logRingStart = 0;

function renderArg(arg: unknown): string {
  if (arg instanceof Error) {
    const code = (arg as { code?: unknown }).code;
    return `${arg.name}: ${arg.message}${code !== undefined ? ` (code=${String(code)})` : ''}`;
  }
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg, (_k, v: unknown) => (v instanceof Error ? renderArg(v) : v)) ?? String(arg);
  } catch {
    return String(arg);
  }
}

function record(level: LogLevel, ns: string, msg: string, args: unknown[]): void {
  const entry: LogRecord = { t: Date.now(), level, ns, msg: String(msg) };
  if (args.length > 0 && (level === 'warn' || level === 'error')) {
    const rendered = args.map(renderArg).join(' ');
    entry.args = rendered.length > ARGS_MAX_CHARS ? `${rendered.slice(0, ARGS_MAX_CHARS)}…` : rendered;
  }
  if (logRing.length < LOG_RING_CAPACITY) {
    logRing.push(entry);
  } else {
    logRing[logRingStart] = entry;
    logRingStart = (logRingStart + 1) % LOG_RING_CAPACITY;
  }
}

/** The retained log records, oldest first (a copy). */
export function getRecentLogs(): LogRecord[] {
  return [...logRing.slice(logRingStart), ...logRing.slice(0, logRingStart)];
}

/**
 * A logger instance bound to a specific namespace/context.
 * Preferred for new code.
 */
class ScopedLogger {
  private namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  debug = (message: string, ...args: unknown[]) => {
    record('debug', this.namespace, message, args);
    if (shouldLog('debug')) {
      console.debug(`[${this.namespace}]`, message, ...args);
    }
  }

  info = (message: string, ...args: unknown[]) => {
    record('info', this.namespace, message, args);
    if (shouldLog('info')) {
      console.info(`[${this.namespace}]`, message, ...args);
    }
  }

  warn = (message: string, ...args: unknown[]) => {
    record('warn', this.namespace, message, args);
    if (shouldLog('warn')) {
      console.warn(`[${this.namespace}]`, message, ...args);
    }
  }

  error = (message: string, ...args: unknown[]) => {
    record('error', this.namespace, message, args);
    if (shouldLog('error')) {
      console.error(`[${this.namespace}]`, message, ...args);
    }
  }
}

export const createLogger = (namespace: string) => new ScopedLogger(namespace);
