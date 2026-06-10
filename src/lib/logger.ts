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

// Helper to access env safely
const getEnv = (): ImportMetaEnv => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (import.meta as any).env || { DEV: false };
};

const shouldLog = (level: LogLevel): boolean => {
  const env = getEnv();
  const configuredLevel = (env.VITE_LOG_LEVEL) || (env.DEV ? 'info' : 'warn');
  return LEVELS[level] >= LEVELS[configuredLevel];
};

/**
 * A logger instance bound to a specific namespace/context.
 * Preferred for new code.
 */
class ScopedLogger {
  private namespace: string;

  constructor(namespace: string) {
    this.namespace = namespace;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  debug = (message: string, ...args: any[]) => {
    if (shouldLog('debug')) {
      console.debug(`[${this.namespace}]`, message, ...args);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  info = (message: string, ...args: any[]) => {
    if (shouldLog('info')) {
      console.info(`[${this.namespace}]`, message, ...args);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  warn = (message: string, ...args: any[]) => {
    if (shouldLog('warn')) {
      console.warn(`[${this.namespace}]`, message, ...args);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  error = (message: string, ...args: any[]) => {
    if (shouldLog('error')) {
      console.error(`[${this.namespace}]`, message, ...args);
    }
  }
}

export const createLogger = (namespace: string) => new ScopedLogger(namespace);
