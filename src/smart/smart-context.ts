/**
 * SmartContextWeaver - Zero-Config Intelligent Context Management
 * 
 * "It just works" - No configuration needed, intelligent by default
 * 
 * Features:
 * - Auto-importance detection
 * - Semantic relevance retrieval
 * - Local summarization (no API needed)
 * - LRU caching for performance
 * - Smart context selection
 */

import type {
  Message,
  MessageRole,
  LLMMessage,
  StorageAdapter,
  ContextResult,
  TokenCounterFunction,
  SummarizerFunction,
} from '../types.js';
import { InMemoryAdapter } from '../adapters/in-memory.js';
import { defaultTokenCounter, countMessageTokens } from '../token-counter.js';
import { generateId, now, sortByTimestamp } from '../utils.js';
import { LRUCache, TokenCache } from './lru-cache.js';
import { AutoImportance, quickImportanceCheck } from './auto-importance.js';
import { SemanticIndex } from './semantic-index.js';
import { LocalSummarizer } from './local-summarizer.js';
import { BloomFilter } from './bloom-filter.js';

export interface SmartContextOptions {
  /** Max tokens for output (default: 4000) */
  tokenLimit?: number;
  /** Storage adapter (default: InMemoryAdapter) */
  storage?: StorageAdapter;
  /** Custom token counter */
  tokenCounter?: TokenCounterFunction;
  /** Use external summarizer instead of local (optional) */
  summarizer?: SummarizerFunction;
  /** Enable semantic search (default: true) */
  enableSemantic?: boolean;
  /** Enable auto-importance (default: true) */
  enableAutoImportance?: boolean;
  /** Enable local summarization (default: true) */
  enableLocalSummary?: boolean;
  /** Cache size for token counts (default: 5000) */
  cacheSize?: number;
}

export interface SmartGetContextOptions {
  /** Max tokens (default: configured tokenLimit) */
  maxTokens?: number;
  /** Current user query for semantic relevance */
  currentQuery?: string;
  /** Minimum importance threshold (default: 0.3) */
  importanceThreshold?: number;
  /** Include semantic matches (default: true) */
  includeSemantic?: boolean;
}

/**
 * SmartContextWeaver - Intelligent context management
 * 
 * @example
 * ```typescript
 * import { SmartContextWeaver } from 'context-weaver/smart';
 * 
 * // Zero config - just works
 * const memory = new SmartContextWeaver();
 * 
 * await memory.add('session-1', 'user', 'My budget is $500');
 * await memory.add('session-1', 'assistant', 'Great! I found options in that range.');
 * await memory.add('session-1', 'user', 'Show me hotels');
 * 
 * // Automatically includes the budget mention because it's important
 * const { messages } = await memory.getContext('session-1', {
 *   currentQuery: 'Show me hotels' // Uses this for semantic relevance
 * });
 * ```
 */
export class SmartContextWeaver {
  private storage: StorageAdapter;
  private tokenCounter: TokenCounterFunction;
  private summarizer: SummarizerFunction;
  private tokenLimit: number;

  // Smart components
  private autoImportance: AutoImportance;
  private semanticIndex: SemanticIndex;
  private localSummarizer: LocalSummarizer;

  // Performance caches
  private tokenCache: TokenCache;
  private contextCache: LRUCache<string, ContextResult>;
  private sessionFilter: BloomFilter;

  // Feature flags
  private enableSemantic: boolean;
  private enableAutoImportance: boolean;
  private enableLocalSummary: boolean;

  constructor(options: SmartContextOptions = {}) {
    this.storage = options.storage ?? new InMemoryAdapter();
    this.tokenCounter = options.tokenCounter ?? defaultTokenCounter;
    this.tokenLimit = options.tokenLimit ?? 4000;

    // Feature flags
    this.enableSemantic = options.enableSemantic ?? true;
    this.enableAutoImportance = options.enableAutoImportance ?? true;
    this.enableLocalSummary = options.enableLocalSummary ?? true;

    // Smart components
    this.autoImportance = new AutoImportance();
    this.semanticIndex = new SemanticIndex();
    this.localSummarizer = new LocalSummarizer();

    // Performance caches
    this.tokenCache = new TokenCache(options.cacheSize ?? 5000);
    this.contextCache = new LRUCache<string, ContextResult>(100, 30000); // 30s TTL
    this.sessionFilter = new BloomFilter(10000);

    // Summarizer: use external if provided, else local
    this.summarizer = options.summarizer ?? (
      (messages: Message[]) => Promise.resolve(this.localSummarizer.summarizeForContext(messages))
    );
  }

  /**
   * Add a message - automatically detects importance
   */
  async add(
    sessionId: string,
    role: MessageRole,
    content: string,
    options: { pinned?: boolean; metadata?: Record<string, unknown> } = {}
  ): Promise<string> {
    // Auto-detect importance if not pinned
    const importance = options.pinned 
      ? 1.0 
      : (this.enableAutoImportance ? quickImportanceCheck(content) : 0.5);

    const message: Message = {
      id: generateId(),
      role,
      content,
      timestamp: now(),
      pinned: options.pinned ?? (importance >= 0.9), // Auto-pin very important
      metadata: options.metadata,
      importance,
    };

    await this.storage.addMessage(sessionId, message);

    // Index for semantic search
    if (this.enableSemantic) {
      this.semanticIndex.add(message);
    }

    // Track session
    this.sessionFilter.add(sessionId);

    // Invalidate context cache
    this.contextCache.delete(this.cacheKey(sessionId));

    // Auto-summarize if needed
    await this.maybeAutoSummarize(sessionId);

    return message.id;
  }

  /**
   * Get optimized context with smart selection
   */
  async getContext(
    sessionId: string,
    options: SmartGetContextOptions = {}
  ): Promise<ContextResult> {
    const maxTokens = options.maxTokens ?? this.tokenLimit;
    const importanceThreshold = options.importanceThreshold ?? 0.3;
    const includeSemantic = options.includeSemantic ?? true;

    // Check cache (if no currentQuery, can use cached)
    if (!options.currentQuery) {
      const cached = this.contextCache.get(this.cacheKey(sessionId, maxTokens));
      if (cached) return cached;
    }

    const allMessages = await this.storage.getMessages(sessionId);
    const summary = await this.storage.getSummary(sessionId);

    // Score and categorize messages
    const scored = this.scoreMessages(allMessages);
    
    // Get semantically relevant messages
    let semanticBoost: Set<string> = new Set();
    if (includeSemantic && options.currentQuery && this.enableSemantic) {
      const relevant = this.semanticIndex.findRelevant(options.currentQuery, allMessages, 5);
      semanticBoost = new Set(relevant.map(m => m.id));
    }

    // Build context with smart selection
    const result = this.buildContext(
      scored,
      summary,
      maxTokens,
      importanceThreshold,
      semanticBoost
    );

    // Cache result
    if (!options.currentQuery) {
      this.contextCache.set(this.cacheKey(sessionId, maxTokens), result);
    }

    return result;
  }

  /**
   * Pin a message
   */
  async pin(sessionId: string, messageId: string): Promise<void> {
    await this.storage.updateMessage(sessionId, messageId, { 
      pinned: true, 
      importance: 1.0 
    });
    this.contextCache.delete(this.cacheKey(sessionId));
  }

  /**
   * Unpin a message
   */
  async unpin(sessionId: string, messageId: string): Promise<void> {
    await this.storage.updateMessage(sessionId, messageId, { pinned: false });
    this.contextCache.delete(this.cacheKey(sessionId));
  }

  /**
   * Clear a session
   */
  async clear(sessionId: string): Promise<void> {
    await this.storage.clearSession(sessionId);
    this.contextCache.delete(this.cacheKey(sessionId));
  }

  /**
   * Get performance stats
   */
  getStats(): {
    tokenCache: ReturnType<TokenCache['getStats']>;
    contextCache: ReturnType<LRUCache<string, ContextResult>['getStats']>;
    semanticIndex: ReturnType<SemanticIndex['getStats']>;
  } {
    return {
      tokenCache: this.tokenCache.getStats(),
      contextCache: this.contextCache.getStats(),
      semanticIndex: this.semanticIndex.getStats(),
    };
  }

  // ============ Private Methods ============

  private cacheKey(sessionId: string, maxTokens?: number): string {
    return `${sessionId}:${maxTokens ?? this.tokenLimit}`;
  }

  private scoreMessages(messages: Message[]): Array<{ message: Message; score: number }> {
    return messages.map((message, index) => ({
      message,
      score: message.importance ?? 
        (this.enableAutoImportance 
          ? this.autoImportance.calculateScore(message, index) 
          : 0.5),
    }));
  }

  private buildContext(
    scored: Array<{ message: Message; score: number }>,
    summary: string | null,
    maxTokens: number,
    importanceThreshold: number,
    semanticBoost: Set<string>
  ): ContextResult {
    const result: LLMMessage[] = [];
    let tokenCount = 0;
    let wasSummarized = false;
    let pinnedCount = 0;

    // 1. Add summary first
    if (summary) {
      const summaryMessage: LLMMessage = {
        role: 'system',
        content: `Previous context: ${summary}`,
      };
      const tokens = this.countTokensCached(summaryMessage);
      if (tokenCount + tokens <= maxTokens) {
        result.push(summaryMessage);
        tokenCount += tokens;
        wasSummarized = true;
      }
    }

    // 2. Separate pinned and regular messages
    const pinned = scored.filter(s => s.message.pinned);
    const regular = scored.filter(s => !s.message.pinned);

    // 3. Add all pinned messages first
    for (const { message } of sortByTimestamp(pinned.map(s => s.message)).map(m => ({ message: m }))) {
      const llmMsg: LLMMessage = { role: message.role, content: message.content };
      const tokens = this.countTokensCached(llmMsg);
      if (tokenCount + tokens <= maxTokens) {
        result.push(llmMsg);
        tokenCount += tokens;
        pinnedCount++;
      }
    }

    // 4. Score and sort remaining messages
    const sortedRegular = regular
      .map(({ message, score }) => ({
        message,
        // Boost score if semantically relevant
        score: semanticBoost.has(message.id) ? Math.min(1.0, score + 0.3) : score,
      }))
      .filter(({ score }) => score >= importanceThreshold)
      .sort((a, b) => {
        // Primary: importance score
        // Secondary: recency (timestamp)
        if (Math.abs(a.score - b.score) > 0.1) {
          return b.score - a.score;
        }
        return b.message.timestamp - a.message.timestamp;
      });

    // 5. Add important/relevant messages
    const added: LLMMessage[] = [];
    for (const { message } of sortedRegular) {
      const llmMsg: LLMMessage = { role: message.role, content: message.content };
      const tokens = this.countTokensCached(llmMsg);
      if (tokenCount + tokens <= maxTokens) {
        added.push(llmMsg);
        tokenCount += tokens;
      } else if (added.length > 10) {
        // Have enough messages
        break;
      }
    }

    // Sort added messages by original timestamp for coherence
    const addedWithTimestamp = added.map((msg, i) => ({
      msg,
      timestamp: sortedRegular[i]?.message.timestamp ?? 0,
    }));
    addedWithTimestamp.sort((a, b) => a.timestamp - b.timestamp);
    result.push(...addedWithTimestamp.map(a => a.msg));

    return {
      messages: result,
      tokenCount,
      messageCount: result.length,
      wasSummarized,
      pinnedCount,
      strategyUsed: 'smart-auto',
    };
  }

  private countTokensCached(message: LLMMessage): number {
    const key = `${message.role}:${message.content}`;
    return this.tokenCache.getTokenCount(key, () => 
      countMessageTokens(message, this.tokenCounter)
    );
  }

  private async maybeAutoSummarize(sessionId: string): Promise<void> {
    const messages = await this.storage.getMessages(sessionId);
    const totalTokens = messages.reduce((sum, m) => 
      sum + this.tokenCache.getTokenCount(m.content, () => this.tokenCounter(m.content)), 
      0
    );

    // Summarize if over 2x token limit
    if (totalTokens > this.tokenLimit * 2 && this.enableLocalSummary) {
      const unpinned = messages.filter(m => !m.pinned);
      const sorted = sortByTimestamp(unpinned);
      const toSummarize = sorted.slice(0, -10); // Keep last 10

      if (toSummarize.length > 5) {
        const summary = await this.summarizer(toSummarize);
        const existingSummary = await this.storage.getSummary(sessionId);
        
        const newSummary = existingSummary 
          ? `${existingSummary} ${summary}`
          : summary;
        
        await this.storage.setSummary(sessionId, newSummary);

        // Delete summarized messages
        for (const msg of toSummarize) {
          await this.storage.deleteMessage(sessionId, msg.id);
          this.semanticIndex.remove(msg.id);
        }
      }
    }
  }
}

/**
 * Quick setup - one line usage
 */
export function createSmartContext(options: SmartContextOptions = {}): SmartContextWeaver {
  return new SmartContextWeaver(options);
}
