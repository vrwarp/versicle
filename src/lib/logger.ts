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
    if (shouldLog('debug')) {
      console.debug(`[${this.namespace}]`, message, ...args);
    }
  }

  info = (message: string, ...args: unknown[]) => {
    if (shouldLog('info')) {
      console.info(`[${this.namespace}]`, message, ...args);
    }
  }

  warn = (message: string, ...args: unknown[]) => {
    if (shouldLog('warn')) {
      console.warn(`[${this.namespace}]`, message, ...args);
    }
  }

  error = (message: string, ...args: unknown[]) => {
    if (shouldLog('error')) {
      console.error(`[${this.namespace}]`, message, ...args);
    }
  }
}

export const createLogger = (namespace: string) => new ScopedLogger(namespace);
