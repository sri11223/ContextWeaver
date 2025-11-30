import type { Message, LLMMessage, TokenCounterFunction } from '../types.js';
import { defaultTokenCounter, countMessageTokens } from '../token-counter.js';

/**
 * Strategy interface for context management
 * Strategies determine which messages to include in context
 */
export interface ContextStrategy {
  /** Name of the strategy for debugging */
  name: string;
  
  /**
   * Select messages to include in context
   * @param messages - All available messages
   * @param options - Strategy-specific options
   * @returns Selected messages in order
   */
  select(messages: Message[], options: StrategyOptions): StrategyResult;
}

export interface StrategyOptions {
  /** Maximum tokens allowed */
  maxTokens: number;
  /** Token counter function */
  tokenCounter?: TokenCounterFunction;
  /** Summary of older messages (if available) */
  summary?: string | null;
  /** Additional strategy-specific options */
  [key: string]: unknown;
}

export interface StrategyResult {
  /** Selected messages */
  messages: LLMMessage[];
  /** Token count of selected messages */
  tokenCount: number;
  /** Messages that were dropped */
  droppedCount: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Sliding Window Strategy
 * 
 * Keeps the N most recent messages, plus all pinned messages.
 * Simple and predictable.
 * 
 * @example
 * ```ts
 * const strategy = new SlidingWindowStrategy({ windowSize: 20 });
 * const result = strategy.select(messages, { maxTokens: 4000 });
 * ```
 */
export class SlidingWindowStrategy implements ContextStrategy {
  name = 'sliding-window';
  private windowSize: number;

  constructor(options: { windowSize?: number } = {}) {
    this.windowSize = options.windowSize ?? 20;
  }

  select(messages: Message[], options: StrategyOptions): StrategyResult {
    const counter = options.tokenCounter ?? defaultTokenCounter;
    const result: LLMMessage[] = [];
    let tokenCount = 0;

    // Always include pinned messages first
    const pinned = messages.filter((m) => m.pinned);
    const unpinned = messages.filter((m) => !m.pinned);

    // Add summary if provided
    if (options.summary) {
      const summaryMsg: LLMMessage = {
        role: 'system',
        content: `Previous conversation summary: ${options.summary}`,
      };
      const tokens = countMessageTokens(summaryMsg, counter);
      if (tokenCount + tokens <= options.maxTokens) {
        result.push(summaryMsg);
        tokenCount += tokens;
      }
    }

    // Add pinned messages
    for (const msg of pinned) {
      const llmMsg: LLMMessage = { role: msg.role, content: msg.content };
      const tokens = countMessageTokens(llmMsg, counter);
      if (tokenCount + tokens <= options.maxTokens) {
        result.push(llmMsg);
        tokenCount += tokens;
      }
    }

    // Add recent messages from window
    const recentMessages = unpinned.slice(-this.windowSize);
    const dropped = unpinned.length - recentMessages.length;

    for (const msg of recentMessages) {
      const llmMsg: LLMMessage = { role: msg.role, content: msg.content };
      const tokens = countMessageTokens(llmMsg, counter);
      if (tokenCount + tokens <= options.maxTokens) {
        result.push(llmMsg);
        tokenCount += tokens;
      }
    }

    return {
      messages: result,
      tokenCount,
      droppedCount: dropped,
      metadata: { windowSize: this.windowSize },
    };
  }
}

/**
 * Token Budget Strategy
 * 
 * Fills context up to the token limit, prioritizing recent messages.
 * Most token-efficient strategy.
 * 
 * @example
 * ```ts
 * const strategy = new TokenBudgetStrategy();
 * const result = strategy.select(messages, { maxTokens: 4000 });
 * ```
 */
export class TokenBudgetStrategy implements ContextStrategy {
  name = 'token-budget';
  private reserveTokens: number;

  constructor(options: { reserveTokens?: number } = {}) {
    this.reserveTokens = options.reserveTokens ?? 500; // Reserve for response
  }

  select(messages: Message[], options: StrategyOptions): StrategyResult {
    const counter = options.tokenCounter ?? defaultTokenCounter;
    const budget = options.maxTokens - this.reserveTokens;
    const result: LLMMessage[] = [];
    let tokenCount = 0;
    let droppedCount = 0;

    // Separate pinned and unpinned
    const pinned = messages.filter((m) => m.pinned);
    const unpinned = messages.filter((m) => !m.pinned);

    // Add summary if provided
    if (options.summary) {
      const summaryMsg: LLMMessage = {
        role: 'system',
        content: `Previous conversation summary: ${options.summary}`,
      };
      const tokens = countMessageTokens(summaryMsg, counter);
      if (tokenCount + tokens <= budget) {
        result.push(summaryMsg);
        tokenCount += tokens;
      }
    }

    // Add all pinned messages (they're important!)
    for (const msg of pinned) {
      const llmMsg: LLMMessage = { role: msg.role, content: msg.content };
      const tokens = countMessageTokens(llmMsg, counter);
      if (tokenCount + tokens <= budget) {
        result.push(llmMsg);
        tokenCount += tokens;
      }
    }

    // Fill remaining budget with recent messages (newest first)
    const reversed = [...unpinned].reverse();
    const selected: LLMMessage[] = [];

    for (const msg of reversed) {
      const llmMsg: LLMMessage = { role: msg.role, content: msg.content };
      const tokens = countMessageTokens(llmMsg, counter);
      if (tokenCount + tokens <= budget) {
        selected.unshift(llmMsg); // Add to front to maintain order
        tokenCount += tokens;
      } else {
        droppedCount++;
      }
    }

    result.push(...selected);

    return {
      messages: result,
      tokenCount,
      droppedCount,
      metadata: { reservedTokens: this.reserveTokens, usedBudget: tokenCount },
    };
  }
}

/**
 * Importance Strategy
 * 
 * Scores messages by importance and includes the most important ones.
 * Uses multiple signals: recency, role, content length, pinned status.
 * 
 * @example
 * ```ts
 * const strategy = new ImportanceStrategy({
 *   recencyWeight: 0.4,
 *   roleWeight: 0.3,
 *   lengthWeight: 0.2,
 *   pinnedWeight: 0.1,
 * });
 * ```
 */
export class ImportanceStrategy implements ContextStrategy {
  name = 'importance';
  private weights: ImportanceWeights;

  constructor(options: Partial<ImportanceWeights> = {}) {
    this.weights = {
      recency: options.recency ?? 0.4,
      role: options.role ?? 0.3,
      length: options.length ?? 0.2,
      pinned: options.pinned ?? 0.1,
    };
  }

  private scoreMessage(msg: Message, index: number, total: number): number {
    let score = 0;

    // Recency score (newer = higher)
    const recencyScore = (index + 1) / total;
    score += recencyScore * this.weights.recency;

    // Role score (system > assistant > user)
    const roleScores: Record<string, number> = {
      system: 1.0,
      assistant: 0.7,
      user: 0.5,
      function: 0.6,
      tool: 0.6,
    };
    score += (roleScores[msg.role] ?? 0.5) * this.weights.role;

    // Length score (medium length preferred)
    const idealLength = 200;
    const lengthDiff = Math.abs(msg.content.length - idealLength);
    const lengthScore = Math.max(0, 1 - lengthDiff / 500);
    score += lengthScore * this.weights.length;

    // Pinned bonus
    if (msg.pinned) {
      score += this.weights.pinned;
    }

    return score;
  }

  select(messages: Message[], options: StrategyOptions): StrategyResult {
    const counter = options.tokenCounter ?? defaultTokenCounter;
    const result: LLMMessage[] = [];
    let tokenCount = 0;

    // Add summary if provided
    if (options.summary) {
      const summaryMsg: LLMMessage = {
        role: 'system',
        content: `Previous conversation summary: ${options.summary}`,
      };
      const tokens = countMessageTokens(summaryMsg, counter);
      if (tokenCount + tokens <= options.maxTokens) {
        result.push(summaryMsg);
        tokenCount += tokens;
      }
    }

    // Score all messages
    const scored = messages.map((msg, index) => ({
      msg,
      score: this.scoreMessage(msg, index, messages.length),
      originalIndex: index,
    }));

    // Sort by score (highest first) but keep pinned at top
    scored.sort((a, b) => {
      if (a.msg.pinned && !b.msg.pinned) return -1;
      if (!a.msg.pinned && b.msg.pinned) return 1;
      return b.score - a.score;
    });

    // Select messages within token budget
    const selected: Array<{ msg: Message; originalIndex: number }> = [];
    let droppedCount = 0;

    for (const item of scored) {
      const llmMsg: LLMMessage = { role: item.msg.role, content: item.msg.content };
      const tokens = countMessageTokens(llmMsg, counter);
      if (tokenCount + tokens <= options.maxTokens) {
        selected.push({ msg: item.msg, originalIndex: item.originalIndex });
        tokenCount += tokens;
      } else {
        droppedCount++;
      }
    }

    // Sort selected by original order
    selected.sort((a, b) => a.originalIndex - b.originalIndex);

    // Convert to LLM messages
    for (const item of selected) {
      result.push({ role: item.msg.role, content: item.msg.content });
    }

    return {
      messages: result,
      tokenCount,
      droppedCount,
      metadata: { weights: this.weights },
    };
  }
}

interface ImportanceWeights {
  recency: number;
  role: number;
  length: number;
  pinned: number;
}

/**
 * Composite Strategy
 * 
 * Combines multiple strategies with fallback behavior.
 * 
 * @example
 * ```ts
 * const strategy = new CompositeStrategy([
 *   new ImportanceStrategy(),
 *   new TokenBudgetStrategy(),
 * ]);
 * ```
 */
export class CompositeStrategy implements ContextStrategy {
  name = 'composite';
  private strategies: ContextStrategy[];

  constructor(strategies: ContextStrategy[]) {
    this.strategies = strategies;
  }

  select(messages: Message[], options: StrategyOptions): StrategyResult {
    // Try each strategy until one succeeds with non-empty result
    for (const strategy of this.strategies) {
      const result = strategy.select(messages, options);
      if (result.messages.length > 0) {
        return {
          ...result,
          metadata: {
            ...result.metadata,
            usedStrategy: strategy.name,
          },
        };
      }
    }

    // All strategies failed, return empty
    return {
      messages: [],
      tokenCount: 0,
      droppedCount: messages.length,
      metadata: { usedStrategy: 'none' },
    };
  }
}
