// Main export
export { ContextWeaver } from './context-weaver.js';

// Types
export type {
  Message,
  MessageRole,
  LLMMessage,
  ContextWeaverOptions,
  GetContextOptions,
  ContextResult,
  StorageAdapter,
  SummarizerFunction,
  TokenCounterFunction,
  SessionStats,
  ContextSelectionStrategy,
  ContextWeaverHooksInterface,
} from './types.js';

// Adapters
export { InMemoryAdapter } from './adapters/in-memory.js';
export { RedisAdapter, type RedisAdapterOptions, type RedisClient } from './adapters/redis.js';
export { PostgresAdapter, type PostgresAdapterOptions, type PostgresClient } from './adapters/postgres.js';

// Strategies
export {
  SlidingWindowStrategy,
  TokenBudgetStrategy,
  ImportanceStrategy,
  CompositeStrategy,
  type ContextStrategy,
  type StrategyOptions,
  type StrategyResult,
} from './strategies/index.js';

// Hooks & Metrics
export {
  ContextWeaverHooks,
  createConsoleLogHook,
  createMetricsReporter,
  type ContextWeaverEventType,
  type ContextWeaverEventMap,
  type ContextWeaverMetrics,
} from './hooks.js';

// Errors
export {
  ContextWeaverError,
  TokenLimitExceededError,
  SessionNotFoundError,
  MessageNotFoundError,
  StorageError,
  SummarizationError,
  ConfigurationError,
  ValidationError,
  isContextWeaverError,
  wrapError,
} from './errors.js';

// Utilities
export {
  defaultTokenCounter,
  countMessageTokens,
  countMessagesTokens,
  createTiktokenCounter,
} from './token-counter.js';
