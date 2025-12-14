/**
 * Enhanced Logging & Observability
 * 
 * Provides structured logging with:
 * - Log levels (debug, info, warn, error)
 * - Context tracking
 * - Performance metrics
 * - Log formatters (JSON, pretty)
 */

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4
}

/**
 * Log entry structure
 */
export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: number;
  context?: Record<string, unknown>;
  error?: Error;
  duration?: number;
}

/**
 * Logger configuration
 */
export interface LoggerOptions {
  /** Minimum log level (default: INFO) */
  level?: LogLevel;
  
  /** Log formatter (default: prettyFormat) */
  formatter?: (entry: LogEntry) => string;
  
  /** Log output function (default: console.log) */
  output?: (formatted: string) => void;
  
  /** Include timestamps (default: true) */
  timestamps?: boolean;
  
  /** Include context in logs (default: true) */
  includeContext?: boolean;
}

/**
 * Logger class for structured logging
 */
export class Logger {
  private level: LogLevel;
  private formatter: (entry: LogEntry) => string;
  private output: (formatted: string) => void;
  private timestamps: boolean;
  private includeContext: boolean;
  private context: Record<string, unknown> = {};
  
  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? LogLevel.INFO;
    this.formatter = options.formatter ?? prettyFormat;
    this.output = options.output ?? console.log;
    this.timestamps = options.timestamps ?? true;
    this.includeContext = options.includeContext ?? true;
  }
  
  /**
   * Set global context for all logs
   */
  setContext(context: Record<string, unknown>): void {
    this.context = { ...this.context, ...context };
  }
  
  /**
   * Clear global context
   */
  clearContext(): void {
    this.context = {};
  }
  
  /**
   * Debug level log
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context);
  }
  
  /**
   * Info level log
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context);
  }
  
  /**
   * Warn level log
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log(LogLevel.WARN, message, context);
  }
  
  /**
   * Error level log
   */
  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.log(LogLevel.ERROR, message, context, error);
  }
  
  /**
   * Time a function execution
   */
  async time<T>(
    label: string,
    fn: () => Promise<T>,
    context?: Record<string, unknown>
  ): Promise<T> {
    const start = Date.now();
    this.debug(`${label} started`, context);
    
    try {
      const result = await fn();
      const duration = Date.now() - start;
      this.debug(`${label} completed`, { ...context, duration });
      return result;
    } catch (error) {
      const duration = Date.now() - start;
      this.error(
        `${label} failed`,
        error instanceof Error ? error : new Error(String(error)),
        { ...context, duration }
      );
      throw error;
    }
  }
  
  /**
   * Internal log method
   */
  private log(
    level: LogLevel,
    message: string,
    context?: Record<string, unknown>,
    error?: Error
  ): void {
    if (level < this.level) {
      return;
    }
    
    const entry: LogEntry = {
      level,
      message,
      timestamp: this.timestamps ? Date.now() : 0,
      context: this.includeContext ? { ...this.context, ...context } : undefined,
      error
    };
    
    const formatted = this.formatter(entry);
    this.output(formatted);
  }
}

/**
 * Pretty format for console output
 */
export function prettyFormat(entry: LogEntry): string {
  const levelColors: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '\x1b[36m', // Cyan
    [LogLevel.INFO]: '\x1b[32m',  // Green
    [LogLevel.WARN]: '\x1b[33m',  // Yellow
    [LogLevel.ERROR]: '\x1b[31m', // Red
    [LogLevel.SILENT]: ''
  };
  
  const levelNames: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'DEBUG',
    [LogLevel.INFO]: 'INFO',
    [LogLevel.WARN]: 'WARN',
    [LogLevel.ERROR]: 'ERROR',
    [LogLevel.SILENT]: ''
  };
  
  const reset = '\x1b[0m';
  const color = levelColors[entry.level];
  const levelName = levelNames[entry.level];
  
  let output = `${color}[${levelName}]${reset}`;
  
  if (entry.timestamp) {
    const date = new Date(entry.timestamp);
    output += ` ${date.toISOString()}`;
  }
  
  output += ` ${entry.message}`;
  
  if (entry.context && Object.keys(entry.context).length > 0) {
    output += `\n  Context: ${JSON.stringify(entry.context, null, 2)}`;
  }
  
  if (entry.error) {
    output += `\n  Error: ${entry.error.message}`;
    if (entry.error.stack) {
      output += `\n  Stack: ${entry.error.stack}`;
    }
  }
  
  return output;
}

/**
 * JSON format for structured logging
 */
export function jsonFormat(entry: LogEntry): string {
  return JSON.stringify({
    level: LogLevel[entry.level],
    message: entry.message,
    timestamp: entry.timestamp,
    context: entry.context,
    error: entry.error ? {
      message: entry.error.message,
      stack: entry.error.stack
    } : undefined
  });
}

/**
 * Create a default logger instance
 */
export const defaultLogger = new Logger();
