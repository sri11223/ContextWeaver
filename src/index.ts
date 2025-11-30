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
} from './types.js';

// Adapters
export { InMemoryAdapter } from './adapters/in-memory.js';

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
