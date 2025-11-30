import type {
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
import { InMemoryAdapter } from './adapters/in-memory.js';
import { defaultTokenCounter, countMessageTokens } from './token-counter.js';
import { generateId, now, sortByTimestamp, partitionMessages } from './utils.js';

/**
 * ContextWeaver - Smart context memory for RAG applications
 * 
 * Manages conversation history intelligently, ensuring you never
 * exceed token limits while preserving important context.
 * 
 * @example
 * ```ts
 * import { ContextWeaver } from 'context-weaver';
 * 
 * const memory = new ContextWeaver({ tokenLimit: 4000 });
 * 
 * // Add messages
 * await memory.add('session-1', 'user', 'My budget is $500');
 * await memory.add('session-1', 'assistant', 'Great! I can help you find options within your budget.');
 * 
 * // Get context safe for LLM
 * const context = await memory.getContext('session-1');
 * 
 * // Use with OpenAI
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages: context.messages,
 * });
 * ```
 */
export class ContextWeaver {
  private storage: StorageAdapter;
  private tokenCounter: TokenCounterFunction;
  private summarizer?: SummarizerFunction;
  private tokenLimit: number;
  private recentMessageCount: number;
  private summarizeThreshold: number;
  private strategy?: ContextSelectionStrategy;
  private hooks?: ContextWeaverHooksInterface;

  constructor(options: ContextWeaverOptions = {}) {
    this.storage = options.storage ?? new InMemoryAdapter();
    this.tokenCounter = options.tokenCounter ?? defaultTokenCounter;
    this.summarizer = options.summarizer;
    this.tokenLimit = options.tokenLimit ?? 4000;
    this.recentMessageCount = options.recentMessageCount ?? 10;
    this.summarizeThreshold = options.summarizeThreshold ?? this.tokenLimit * 2;
    this.strategy = options.strategy;
    this.hooks = options.hooks;
  }

  /**
   * Add a message to the conversation history
   * 
   * @param sessionId - Unique identifier for the conversation session
   * @param role - Message role (user, assistant, system, etc.)
   * @param content - The message content
   * @param options - Additional options like pinning or metadata
   * @returns The created message ID
   * 
   * @example
   * ```ts
   * // Simple usage
   * await memory.add('session-1', 'user', 'Hello!');
   * 
   * // With pinning (important messages)
   * await memory.add('session-1', 'system', 'You are a helpful assistant.', { pinned: true });
   * 
   * // With metadata
   * await memory.add('session-1', 'user', 'Search for hotels', { 
   *   metadata: { intent: 'search', category: 'travel' } 
   * });
   * ```
   */
  async add(
    sessionId: string,
    role: MessageRole,
    content: string,
    options: { pinned?: boolean; metadata?: Record<string, unknown>; importance?: number } = {}
  ): Promise<string> {
    const startTime = Date.now();
    
    const message: Message = {
      id: generateId(),
      role,
      content,
      timestamp: now(),
      pinned: options.pinned,
      metadata: options.metadata,
      importance: options.importance,
    };

    await this.storage.addMessage(sessionId, message);

    // Emit hook event
    if (this.hooks) {
      await this.hooks.emit('messageAdded', {
        sessionId,
        timestamp: message.timestamp,
        message,
      });
      this.hooks.recordResponseTime(Date.now() - startTime);
    }

    // Check if we should auto-summarize
    await this.maybeAutoSummarize(sessionId);

    return message.id;
  }

  /**
   * Get optimized context ready to send to an LLM
   * 
   * This is the main method you'll use. It returns messages that:
   * - Fit within your token budget
   * - Include all pinned messages
   * - Include a summary of older messages (if available)
   * - Are sorted chronologically
   * 
   * @param sessionId - The session to get context for
   * @param options - Customization options
   * @returns Context result with messages and metadata
   * 
   * @example
   * ```ts
   * // Basic usage
   * const ctx = await memory.getContext('session-1');
   * console.log(ctx.messages); // Ready for OpenAI
   * 
   * // With custom token limit
   * const ctx = await memory.getContext('session-1', { maxTokens: 2000 });
   * 
   * // Check if summarization occurred
   * if (ctx.wasSummarized) {
   *   console.log('Older messages were summarized');
   * }
   * ```
   */
  async getContext(
    sessionId: string,
    options: GetContextOptions = {}
  ): Promise<ContextResult> {
    const startTime = Date.now();
    const maxTokens = options.maxTokens ?? this.tokenLimit;
    const includePinned = options.includePinned ?? true;
    const includeSummary = options.includeSummary ?? true;
    const activeStrategy = options.strategy ?? this.strategy;

    const allMessages = await this.storage.getMessages(sessionId);
    const summary = includeSummary ? await this.storage.getSummary(sessionId) : null;

    // Partition messages
    const { pinned, unpinned } = partitionMessages(allMessages);
    let sortedUnpinned = sortByTimestamp(unpinned);

    // Apply strategy if configured
    let strategyUsed: string | undefined;
    if (activeStrategy) {
      const remainingTokens = maxTokens - this.calculatePinnedTokens(pinned, summary);
      sortedUnpinned = activeStrategy.select(sortedUnpinned, remainingTokens, this.tokenCounter);
      strategyUsed = activeStrategy.name;

      // Emit strategy event
      if (this.hooks) {
        await this.hooks.emit('strategyApplied', {
          sessionId,
          timestamp: Date.now(),
          strategyName: activeStrategy.name,
          inputMessages: unpinned.length,
          outputMessages: sortedUnpinned.length,
          tokensUsed: this.countMessagesTokens(sortedUnpinned),
          maxTokens,
        });
      }
    }

    // Start building context
    const result: LLMMessage[] = [];
    let tokenCount = 0;
    let wasSummarized = false;

    // 1. Add summary first (if exists)
    if (summary) {
      const summaryMessage: LLMMessage = {
        role: 'system',
        content: `Previous conversation summary: ${summary}`,
      };
      const summaryTokens = countMessageTokens(summaryMessage, this.tokenCounter);
      
      if (tokenCount + summaryTokens <= maxTokens) {
        result.push(summaryMessage);
        tokenCount += summaryTokens;
        wasSummarized = true;
      }
    }

    // 2. Add pinned messages
    const sortedPinned = includePinned ? sortByTimestamp(pinned) : [];
    for (const msg of sortedPinned) {
      const llmMsg: LLMMessage = { role: msg.role, content: msg.content };
      const msgTokens = countMessageTokens(llmMsg, this.tokenCounter);
      
      if (tokenCount + msgTokens <= maxTokens) {
        result.push(llmMsg);
        tokenCount += msgTokens;
      }
    }

    // 3. Add recent messages (from newest to oldest, then reverse)
    const recentMessages: LLMMessage[] = [];
    const reversedUnpinned = [...sortedUnpinned].reverse();

    for (const msg of reversedUnpinned) {
      const llmMsg: LLMMessage = { role: msg.role, content: msg.content };
      const msgTokens = countMessageTokens(llmMsg, this.tokenCounter);

      if (tokenCount + msgTokens <= maxTokens) {
        recentMessages.unshift(llmMsg); // Add to front to maintain order
        tokenCount += msgTokens;
      } else {
        // We've hit the token limit
        break;
      }
    }

    result.push(...recentMessages);

    // Check token limit warning
    const usagePercentage = (tokenCount / maxTokens) * 100;
    if (usagePercentage >= 80 && this.hooks) {
      await this.hooks.emit('tokenLimitApproached', {
        sessionId,
        timestamp: Date.now(),
        currentTokens: tokenCount,
        maxTokens,
        usagePercentage,
      });
    }

    // Emit retrieval event
    if (this.hooks) {
      await this.hooks.emit('messagesRetrieved', {
        sessionId,
        timestamp: Date.now(),
        messages: result.map(m => ({
          id: '',
          role: m.role,
          content: m.content,
          timestamp: Date.now(),
        })),
        totalTokens: tokenCount,
        maxTokens,
        strategyUsed: strategyUsed ?? null,
      });
      this.hooks.recordResponseTime(Date.now() - startTime);
    }

    return {
      messages: result,
      tokenCount,
      messageCount: result.length,
      wasSummarized,
      pinnedCount: sortedPinned.length,
      strategyUsed,
    };
  }

  /**
   * Calculate tokens used by pinned messages and summary
   */
  private calculatePinnedTokens(pinned: Message[], summary: string | null): number {
    let tokens = 0;
    
    if (summary) {
      tokens += countMessageTokens({ role: 'system', content: `Previous conversation summary: ${summary}` }, this.tokenCounter);
    }
    
    for (const msg of pinned) {
      tokens += countMessageTokens({ role: msg.role, content: msg.content }, this.tokenCounter);
    }
    
    return tokens;
  }

  /**
   * Count tokens for a list of messages
   */
  private countMessagesTokens(messages: Message[]): number {
    return messages.reduce((total, msg) => 
      total + countMessageTokens({ role: msg.role, content: msg.content }, this.tokenCounter), 
      0
    );
  }

  /**
   * Pin a message so it's never dropped from context
   * 
   * Useful for system instructions, user preferences, or key information
   * that should always be included.
   * 
   * @param sessionId - The session containing the message
   * @param messageId - The ID of the message to pin
   * 
   * @example
   * ```ts
   * const id = await memory.add('session-1', 'user', 'My name is Alice');
   * await memory.pin('session-1', id);
   * ```
   */
  async pin(sessionId: string, messageId: string): Promise<void> {
    await this.storage.updateMessage(sessionId, messageId, { pinned: true });
    
    if (this.hooks) {
      await this.hooks.emit('messagePinned', {
        sessionId,
        timestamp: Date.now(),
        messageId,
        pinned: true,
      });
    }
  }

  /**
   * Unpin a message
   * 
   * @param sessionId - The session containing the message
   * @param messageId - The ID of the message to unpin
   */
  async unpin(sessionId: string, messageId: string): Promise<void> {
    await this.storage.updateMessage(sessionId, messageId, { pinned: false });
    
    if (this.hooks) {
      await this.hooks.emit('messageUnpinned', {
        sessionId,
        timestamp: Date.now(),
        messageId,
        pinned: false,
      });
    }
  }

  /**
   * Manually trigger summarization of older messages
   * 
   * This requires a summarizer function to be configured.
   * 
   * @param sessionId - The session to summarize
   * @param keepRecent - Number of recent messages to keep (default: recentMessageCount)
   * 
   * @example
   * ```ts
   * const memory = new ContextWeaver({
   *   summarizer: async (messages) => {
   *     const response = await openai.chat.completions.create({
   *       model: 'gpt-3.5-turbo',
   *       messages: [
   *         { role: 'system', content: 'Summarize this conversation briefly.' },
   *         ...messages.map(m => ({ role: m.role, content: m.content }))
   *       ]
   *     });
   *     return response.choices[0].message.content;
   *   }
   * });
   * 
   * await memory.summarize('session-1');
   * ```
   */
  async summarize(sessionId: string, keepRecent?: number): Promise<string | null> {
    if (!this.summarizer) {
      console.warn('ContextWeaver: No summarizer configured. Skipping summarization.');
      return null;
    }

    const allMessages = await this.storage.getMessages(sessionId);
    const { unpinned } = partitionMessages(allMessages);
    const sorted = sortByTimestamp(unpinned);

    const keep = keepRecent ?? this.recentMessageCount;
    if (sorted.length <= keep) {
      // Not enough messages to summarize
      return null;
    }

    // Messages to summarize (older ones)
    const toSummarize = sorted.slice(0, -keep);
    
    // Get existing summary and prepend if exists
    const existingSummary = await this.storage.getSummary(sessionId);
    
    // Create messages for summarization
    const summaryInput: Message[] = existingSummary
      ? [{ id: 'existing', role: 'system' as const, content: `Previous summary: ${existingSummary}`, timestamp: 0 }, ...toSummarize]
      : toSummarize;

    // Generate new summary
    const newSummary = await this.summarizer(summaryInput);
    await this.storage.setSummary(sessionId, newSummary);

    // Delete summarized messages (keep pinned)
    for (const msg of toSummarize) {
      await this.storage.deleteMessage(sessionId, msg.id);
    }

    return newSummary;
  }

  /**
   * Get all messages for a session (including pinned)
   * 
   * @param sessionId - The session to get messages for
   * @returns All messages in chronological order
   */
  async getMessages(sessionId: string): Promise<Message[]> {
    const messages = await this.storage.getMessages(sessionId);
    return sortByTimestamp(messages);
  }

  /**
   * Get statistics about a session
   * 
   * @param sessionId - The session to get stats for
   * @returns Session statistics
   */
  async getStats(sessionId: string): Promise<SessionStats> {
    const messages = await this.storage.getMessages(sessionId);
    const summary = await this.storage.getSummary(sessionId);

    let estimatedTokens = 0;
    let pinnedMessages = 0;
    let oldestMessage: number | undefined;
    let newestMessage: number | undefined;

    for (const msg of messages) {
      estimatedTokens += countMessageTokens(
        { role: msg.role, content: msg.content },
        this.tokenCounter
      );
      if (msg.pinned) pinnedMessages++;
      
      if (oldestMessage === undefined || msg.timestamp < oldestMessage) {
        oldestMessage = msg.timestamp;
      }
      if (newestMessage === undefined || msg.timestamp > newestMessage) {
        newestMessage = msg.timestamp;
      }
    }

    return {
      totalMessages: messages.length,
      pinnedMessages,
      estimatedTokens,
      hasSummary: summary !== null,
      oldestMessage,
      newestMessage,
    };
  }

  /**
   * Clear all messages for a session
   * 
   * @param sessionId - The session to clear
   */
  async clear(sessionId: string): Promise<void> {
    await this.storage.clearSession(sessionId);
  }

  /**
   * Check if a session exists
   * 
   * @param sessionId - The session to check
   */
  async hasSession(sessionId: string): Promise<boolean> {
    return this.storage.hasSession(sessionId);
  }

  /**
   * Get the configured token limit
   */
  getTokenLimit(): number {
    return this.tokenLimit;
  }

  /**
   * Update configuration at runtime
   */
  configure(options: Partial<ContextWeaverOptions>): void {
    if (options.tokenLimit !== undefined) this.tokenLimit = options.tokenLimit;
    if (options.recentMessageCount !== undefined) this.recentMessageCount = options.recentMessageCount;
    if (options.summarizeThreshold !== undefined) this.summarizeThreshold = options.summarizeThreshold;
    if (options.tokenCounter !== undefined) this.tokenCounter = options.tokenCounter;
    if (options.summarizer !== undefined) this.summarizer = options.summarizer;
  }

  /**
   * Auto-summarize if token count exceeds threshold
   */
  private async maybeAutoSummarize(sessionId: string): Promise<void> {
    if (!this.summarizer) return;

    const stats = await this.getStats(sessionId);
    if (stats.estimatedTokens >= this.summarizeThreshold) {
      await this.summarize(sessionId);
    }
  }
}
