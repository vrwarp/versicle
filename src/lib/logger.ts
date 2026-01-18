/**
 * Defines the available logging levels.
 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

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
 * Service for handling application logging with context and severity levels.
 * This is the legacy singleton logger that requires manual context passing.
 */
class GlobalLoggerService {
  private formatMessage(context: string, message: string): string {
    return `[${context}] ${message}`;
  }

  /**
   * Log an informational message.
   * @param context The context/component where the log originated.
   * @param message The message to log.
   * @param data Optional data to log.
   */
  info(context: string, message: string, data?: unknown): void {
    if (shouldLog('info')) {
      console.info(this.formatMessage(context, message), data !== undefined ? data : '');
    }
  }

  /**
   * Log a warning message.
   * @param context The context/component where the log originated.
   * @param message The message to log.
   * @param data Optional data to log.
   */
  warn(context: string, message: string, data?: unknown): void {
    if (shouldLog('warn')) {
      console.warn(this.formatMessage(context, message), data !== undefined ? data : '');
    }
  }

  /**
   * Log an error message.
   * @param context The context/component where the log originated.
   * @param message The message to log.
   * @param error Optional error object or data.
   */
  error(context: string, message: string, error?: unknown): void {
    if (shouldLog('error')) {
      console.error(this.formatMessage(context, message), error !== undefined ? error : '');
    }
  }

  /**
   * Log a debug message.
   * @param context The context/component where the log originated.
   * @param message The message to log.
   * @param data Optional data to log.
   */
  debug(context: string, message: string, data?: unknown): void {
    if (shouldLog('debug')) {
      console.debug(this.formatMessage(context, message), data !== undefined ? data : '');
    }
  }
}

/**
 * A logger instance bound to a specific namespace/context.
 * Preferred for new code.
 */
export class ScopedLogger {
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

export const Logger = new GlobalLoggerService();
export const createLogger = (namespace: string) => new ScopedLogger(namespace);
