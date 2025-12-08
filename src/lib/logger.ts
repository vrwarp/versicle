export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: unknown;
  error?: unknown;
}

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
