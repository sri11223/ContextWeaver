/**
 * Smart Auto-Context System
 * 
 * Zero-config, intelligent context management that "just works"
 * 
 * Features:
 * - Auto-importance detection (keywords, patterns)
 * - Built-in local summarization (no API needed)
 * - Semantic similarity with TF-IDF (lightweight)
 * - LRU caching for performance
 * - Bloom filters for fast lookups
 * - Conversation pairs (keep Q&A together)
 */

export { SmartContextWeaver } from './smart-context.js';
export type { SmartContextOptions, SmartGetContextOptions } from './smart-context.js';
export { AutoImportance, type ImportanceRule, DEFAULT_RULES, quickImportanceCheck } from './auto-importance.js';
export { LocalSummarizer, quickSummarize } from './local-summarizer.js';
export { SemanticIndex } from './semantic-index.js';
export { LRUCache, TokenCache } from './lru-cache.js';
export { BloomFilter, CountingBloomFilter } from './bloom-filter.js';
export { 
  ConversationPairManager, 
  ConversationPairStrategy,
  hasConversationReference,
  type ConversationPair 
} from './conversation-pairs.js';
