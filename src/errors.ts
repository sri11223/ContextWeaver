/**
 * Base error class for ContextWeaver
 */
export class ContextWeaverError extends Error {
  readonly code: string;
  readonly context?: Record<string, unknown>;

  constructor(message: string, code: string, context?: Record<string, unknown>) {
    super(message);
    this.name = 'ContextWeaverError';
    this.code = code;
    this.context = context;

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
    };
  }
}

/**
 * Thrown when token limit is exceeded and cannot be resolved
 */
export class TokenLimitExceededError extends ContextWeaverError {
  constructor(
    requested: number,
    limit: number,
    context?: Record<string, unknown>
  ) {
    super(
      `Token limit exceeded: requested ${requested} tokens, but limit is ${limit}`,
      'TOKEN_LIMIT_EXCEEDED',
      { requested, limit, ...context }
    );
    this.name = 'TokenLimitExceededError';
  }
}

/**
 * Thrown when a session is not found
 */
export class SessionNotFoundError extends ContextWeaverError {
  constructor(sessionId: string) {
    super(
      `Session not found: ${sessionId}`,
      'SESSION_NOT_FOUND',
      { sessionId }
    );
    this.name = 'SessionNotFoundError';
  }
}

/**
 * Thrown when a message is not found
 */
export class MessageNotFoundError extends ContextWeaverError {
  constructor(sessionId: string, messageId: string) {
    super(
      `Message not found: ${messageId} in session ${sessionId}`,
      'MESSAGE_NOT_FOUND',
      { sessionId, messageId }
    );
    this.name = 'MessageNotFoundError';
  }
}

/**
 * Thrown when storage operations fail
 */
export class StorageError extends ContextWeaverError {
  readonly originalError?: Error;

  constructor(operation: string, originalError?: Error) {
    super(
      `Storage operation failed: ${operation}${originalError ? ` - ${originalError.message}` : ''}`,
      'STORAGE_ERROR',
      { operation }
    );
    this.name = 'StorageError';
    this.originalError = originalError;
  }
}

/**
 * Thrown when summarization fails
 */
export class SummarizationError extends ContextWeaverError {
  readonly originalError?: Error;

  constructor(message: string, originalError?: Error) {
    super(
      `Summarization failed: ${message}`,
      'SUMMARIZATION_ERROR',
      { originalMessage: message }
    );
    this.name = 'SummarizationError';
    this.originalError = originalError;
  }
}

/**
 * Thrown when configuration is invalid
 */
export class ConfigurationError extends ContextWeaverError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      `Invalid configuration: ${message}`,
      'CONFIGURATION_ERROR',
      context
    );
    this.name = 'ConfigurationError';
  }
}

/**
 * Thrown when validation fails
 */
export class ValidationError extends ContextWeaverError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(
      `Validation failed: ${message}`,
      'VALIDATION_ERROR',
      context
    );
    this.name = 'ValidationError';
  }
}

/**
 * Check if an error is a ContextWeaver error
 */
export function isContextWeaverError(error: unknown): error is ContextWeaverError {
  return error instanceof ContextWeaverError;
}

/**
 * Wrap an unknown error in a ContextWeaverError
 */
export function wrapError(error: unknown, operation: string): ContextWeaverError {
  if (error instanceof ContextWeaverError) {
    return error;
  }

  if (error instanceof Error) {
    return new StorageError(operation, error);
  }

  return new ContextWeaverError(
    `Unknown error during ${operation}: ${String(error)}`,
    'UNKNOWN_ERROR',
    { originalError: error }
  );
}
