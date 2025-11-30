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

// Utilities
export {
  defaultTokenCounter,
  countMessageTokens,
  countMessagesTokens,
  createTiktokenCounter,
} from './token-counter.js';
