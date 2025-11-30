// Main export
export { ContextWeaver } from './context-weaver.js';

// Smart Context (Zero-Config)
export { 
  SmartContextWeaver, 
  createSmartContext,
  type SmartContextOptions,
  type SmartGetContextOptions,
} from './smart/smart-context.js';

// Smart Utilities
export { AutoImportance, quickImportanceCheck, type ImportanceRule } from './smart/auto-importance.js';
export { SemanticIndex, quickRelevanceScore } from './smart/semantic-index.js';
export { LocalSummarizer, quickSummarize } from './smart/local-summarizer.js';
export { LRUCache, TokenCache } from './smart/lru-cache.js';
export { BloomFilter, CountingBloomFilter } from './smart/bloom-filter.js';

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
