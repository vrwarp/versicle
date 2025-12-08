/**
 * Defines the available logging levels.
 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

/**
 * Represents a single log entry.
 */
export interface LogEntry {
  /** ISO timestamp of the log entry. */
  timestamp: string;
  /** The severity level of the log. */
  level: LogLevel;
  /** The context or component source of the log. */
  context: string;
  /** The log message. */
  message: string;
  /** Optional associated data. */
  data?: unknown;
  /** Optional associated error object. */
  error?: unknown;
}

/**
 * Service for handling application logging with context and severity levels.
 * Currently writes to the console.
 */
class LoggerService {
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
    console.log(this.formatMessage(context, message), data !== undefined ? data : '');
  }

  /**
   * Log a warning message.
   * @param context The context/component where the log originated.
   * @param message The message to log.
   * @param data Optional data to log.
   */
  warn(context: string, message: string, data?: unknown): void {
    console.warn(this.formatMessage(context, message), data !== undefined ? data : '');
  }

  /**
   * Log an error message.
   * @param context The context/component where the log originated.
   * @param message The message to log.
   * @param error Optional error object or data.
   */
  error(context: string, message: string, error?: unknown): void {
    console.error(this.formatMessage(context, message), error !== undefined ? error : '');
  }

  /**
   * Log a debug message.
   * @param context The context/component where the log originated.
   * @param message The message to log.
   * @param data Optional data to log.
   */
  debug(context: string, message: string, data?: unknown): void {
    console.debug(this.formatMessage(context, message), data !== undefined ? data : '');
  }
}

export const Logger = new LoggerService();
