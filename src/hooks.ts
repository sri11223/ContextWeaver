import type { Message } from './types.js';

/**
 * Event types emitted by ContextWeaver
 */
export type ContextWeaverEventType =
  | 'messageAdded'
  | 'messagesRetrieved'
  | 'messagePinned'
  | 'messageUnpinned'
  | 'messageDeleted'
  | 'sessionCleared'
  | 'summaryCreated'
  | 'strategyApplied'
  | 'tokenLimitApproached'
  | 'error';

/**
 * Base event payload
 */
export interface BaseEventPayload {
  sessionId: string;
  timestamp: number;
}

/**
 * Message added event
 */
export interface MessageAddedPayload extends BaseEventPayload {
  message: Message;
}

/**
 * Messages retrieved event
 */
export interface MessagesRetrievedPayload extends BaseEventPayload {
  messages: Message[];
  totalTokens: number;
  maxTokens: number;
  strategyUsed: string | null;
}

/**
 * Message pinned/unpinned event
 */
export interface MessagePinnedPayload extends BaseEventPayload {
  messageId: string;
  pinned: boolean;
}

/**
 * Message deleted event
 */
export interface MessageDeletedPayload extends BaseEventPayload {
  messageId: string;
}

/**
 * Session cleared event
 */
export interface SessionClearedPayload extends BaseEventPayload {
  messagesCleared: number;
}

/**
 * Summary created event
 */
export interface SummaryCreatedPayload extends BaseEventPayload {
  summary: string;
  originalMessageCount: number;
  tokensSaved: number;
}

/**
 * Strategy applied event
 */
export interface StrategyAppliedPayload extends BaseEventPayload {
  strategyName: string;
  inputMessages: number;
  outputMessages: number;
  tokensUsed: number;
  maxTokens: number;
}

/**
 * Token limit approached event (>80% usage)
 */
export interface TokenLimitApproachedPayload extends BaseEventPayload {
  currentTokens: number;
  maxTokens: number;
  usagePercentage: number;
}

/**
 * Error event
 */
export interface ErrorEventPayload extends BaseEventPayload {
  error: Error;
  operation: string;
}

/**
 * Event payload map
 */
export interface ContextWeaverEventMap {
  messageAdded: MessageAddedPayload;
  messagesRetrieved: MessagesRetrievedPayload;
  messagePinned: MessagePinnedPayload;
  messageUnpinned: MessagePinnedPayload;
  messageDeleted: MessageDeletedPayload;
  sessionCleared: SessionClearedPayload;
  summaryCreated: SummaryCreatedPayload;
  strategyApplied: StrategyAppliedPayload;
  tokenLimitApproached: TokenLimitApproachedPayload;
  error: ErrorEventPayload;
}

/**
 * Event listener type
 */
export type EventListener<T extends ContextWeaverEventType> = (
  payload: ContextWeaverEventMap[T]
) => void | Promise<void>;

/**
 * Metrics data structure
 */
export interface ContextWeaverMetrics {
  /** Total messages added across all sessions */
  messagesAdded: number;
  /** Total messages retrieved */
  messagesRetrieved: number;
  /** Total tokens processed */
  tokensProcessed: number;
  /** Number of strategy applications */
  strategyApplications: number;
  /** Number of summaries created */
  summariesCreated: number;
  /** Number of errors occurred */
  errors: number;
  /** Average response time in ms */
  averageResponseTime: number;
  /** Peak token usage */
  peakTokenUsage: number;
  /** Session statistics by sessionId */
  sessionStats: Map<
    string,
    {
      messageCount: number;
      tokenCount: number;
      lastAccess: number;
    }
  >;
}

/**
 * Hooks and Metrics System for ContextWeaver
 * 
 * Provides:
 * - Event emission for all operations
 * - Built-in metrics collection
 * - Custom hook registration
 * 
 * @example
 * ```ts
 * const hooks = new ContextWeaverHooks();
 * 
 * // Listen to specific events
 * hooks.on('messageAdded', (payload) => {
 *   console.log(`Message added to ${payload.sessionId}`);
 * });
 * 
 * // Listen to all events for logging
 * hooks.onAny((event, payload) => {
 *   logger.info(`ContextWeaver: ${event}`, payload);
 * });
 * 
 * // Get metrics
 * const metrics = hooks.getMetrics();
 * ```
 */
export class ContextWeaverHooks {
  private listeners = new Map<ContextWeaverEventType, Set<EventListener<ContextWeaverEventType>>>();
  private anyListeners = new Set<(event: ContextWeaverEventType, payload: unknown) => void>();
  private metrics: ContextWeaverMetrics;
  private responseTimes: number[] = [];
  private maxResponseTimeHistory = 1000;

  constructor() {
    this.metrics = this.createInitialMetrics();
  }

  private createInitialMetrics(): ContextWeaverMetrics {
    return {
      messagesAdded: 0,
      messagesRetrieved: 0,
      tokensProcessed: 0,
      strategyApplications: 0,
      summariesCreated: 0,
      errors: 0,
      averageResponseTime: 0,
      peakTokenUsage: 0,
      sessionStats: new Map(),
    };
  }

  /**
   * Register an event listener
   */
  on<T extends ContextWeaverEventType>(
    event: T,
    listener: EventListener<T>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    
    const listeners = this.listeners.get(event)!;
    listeners.add(listener as EventListener<ContextWeaverEventType>);

    // Return unsubscribe function
    return () => {
      listeners.delete(listener as EventListener<ContextWeaverEventType>);
    };
  }

  /**
   * Register a listener for all events
   */
  onAny(
    listener: (event: ContextWeaverEventType, payload: unknown) => void
  ): () => void {
    this.anyListeners.add(listener);
    return () => {
      this.anyListeners.delete(listener);
    };
  }

  /**
   * Remove an event listener
   */
  off<T extends ContextWeaverEventType>(
    event: T,
    listener: EventListener<T>
  ): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener as EventListener<ContextWeaverEventType>);
    }
  }

  /**
   * Emit an event
   */
  async emit<T extends ContextWeaverEventType>(
    event: T,
    payload: ContextWeaverEventMap[T]
  ): Promise<void> {
    // Update metrics based on event
    this.updateMetrics(event, payload);

    // Notify specific listeners
    const listeners = this.listeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          await listener(payload);
        } catch (error) {
          console.error(`Error in event listener for ${event}:`, error);
        }
      }
    }

    // Notify any listeners
    for (const listener of this.anyListeners) {
      try {
        await listener(event, payload);
      } catch (error) {
        console.error(`Error in any-event listener for ${event}:`, error);
      }
    }
  }

  /**
   * Update metrics based on events
   */
  private updateMetrics<T extends ContextWeaverEventType>(
    event: T,
    payload: ContextWeaverEventMap[T]
  ): void {
    const basePayload = payload as BaseEventPayload;
    
    switch (event) {
      case 'messageAdded': {
        this.metrics.messagesAdded++;
        this.updateSessionStats(basePayload.sessionId, 1, 0);
        break;
      }
      case 'messagesRetrieved': {
        const p = payload as MessagesRetrievedPayload;
        this.metrics.messagesRetrieved += p.messages.length;
        this.metrics.tokensProcessed += p.totalTokens;
        if (p.totalTokens > this.metrics.peakTokenUsage) {
          this.metrics.peakTokenUsage = p.totalTokens;
        }
        this.updateSessionStats(basePayload.sessionId, 0, p.totalTokens);
        break;
      }
      case 'strategyApplied': {
        this.metrics.strategyApplications++;
        break;
      }
      case 'summaryCreated': {
        this.metrics.summariesCreated++;
        break;
      }
      case 'error': {
        this.metrics.errors++;
        break;
      }
    }
  }

  /**
   * Update session-specific statistics
   */
  private updateSessionStats(
    sessionId: string,
    messages: number,
    tokens: number
  ): void {
    const existing = this.metrics.sessionStats.get(sessionId) ?? {
      messageCount: 0,
      tokenCount: 0,
      lastAccess: 0,
    };

    this.metrics.sessionStats.set(sessionId, {
      messageCount: existing.messageCount + messages,
      tokenCount: tokens > 0 ? tokens : existing.tokenCount,
      lastAccess: Date.now(),
    });
  }

  /**
   * Record a response time measurement
   */
  recordResponseTime(ms: number): void {
    this.responseTimes.push(ms);
    
    // Keep only recent measurements
    if (this.responseTimes.length > this.maxResponseTimeHistory) {
      this.responseTimes.shift();
    }

    // Update average
    this.metrics.averageResponseTime =
      this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;
  }

  /**
   * Get current metrics
   */
  getMetrics(): Readonly<Omit<ContextWeaverMetrics, 'sessionStats'>> & {
    sessionCount: number;
    activeSessions: number;
  } {
    const now = Date.now();
    const activeThreshold = 5 * 60 * 1000; // 5 minutes

    let activeSessions = 0;
    for (const stats of this.metrics.sessionStats.values()) {
      if (now - stats.lastAccess < activeThreshold) {
        activeSessions++;
      }
    }

    return {
      messagesAdded: this.metrics.messagesAdded,
      messagesRetrieved: this.metrics.messagesRetrieved,
      tokensProcessed: this.metrics.tokensProcessed,
      strategyApplications: this.metrics.strategyApplications,
      summariesCreated: this.metrics.summariesCreated,
      errors: this.metrics.errors,
      averageResponseTime: this.metrics.averageResponseTime,
      peakTokenUsage: this.metrics.peakTokenUsage,
      sessionCount: this.metrics.sessionStats.size,
      activeSessions,
    };
  }

  /**
   * Get metrics for a specific session
   */
  getSessionMetrics(sessionId: string): {
    messageCount: number;
    tokenCount: number;
    lastAccess: number;
  } | null {
    return this.metrics.sessionStats.get(sessionId) ?? null;
  }

  /**
   * Reset all metrics
   */
  resetMetrics(): void {
    this.metrics = this.createInitialMetrics();
    this.responseTimes = [];
  }

  /**
   * Remove all listeners
   */
  removeAllListeners(): void {
    this.listeners.clear();
    this.anyListeners.clear();
  }
}

/**
 * Create a logging hook that outputs to console
 */
export function createConsoleLogHook(): (
  event: ContextWeaverEventType,
  payload: unknown
) => void {
  return (event, payload) => {
    const p = payload as BaseEventPayload;
    console.log(`[ContextWeaver] ${event}`, {
      sessionId: p.sessionId,
      timestamp: new Date(p.timestamp).toISOString(),
      event,
      payload,
    });
  };
}

/**
 * Create a metrics reporting hook
 */
export function createMetricsReporter(
  reportFn: (metrics: ReturnType<ContextWeaverHooks['getMetrics']>) => void,
  hooks: ContextWeaverHooks,
  intervalMs: number = 60000
): { start: () => void; stop: () => void } {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start: () => {
      timer = setInterval(() => {
        reportFn(hooks.getMetrics());
      }, intervalMs);
    },
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
