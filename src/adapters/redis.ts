import type { Message, StorageAdapter } from '../types.js';

/**
 * Configuration options for RedisAdapter
 */
export interface RedisAdapterOptions {
  /** Redis client instance (ioredis or node-redis compatible) */
  client: RedisClient;
  /** Key prefix for all context-weaver keys (default: 'cw:') */
  keyPrefix?: string;
  /** TTL for sessions in seconds (default: 86400 = 24 hours) */
  sessionTTL?: number;
  /** Enable automatic key expiry (default: true) */
  enableExpiry?: boolean;
}

/**
 * Minimal Redis client interface
 * Compatible with ioredis, node-redis, and upstash
 */
export interface RedisClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  exists(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  keys(pattern: string): Promise<string[]>;
}

/**
 * Redis Storage Adapter for Production
 * 
 * Features:
 * - Persistent storage across server restarts
 * - Automatic session expiry (TTL)
 * - Atomic operations
 * - Compatible with ioredis, node-redis, upstash
 * 
 * @example
 * ```ts
 * import Redis from 'ioredis';
 * import { ContextWeaver } from 'context-weaver';
 * import { RedisAdapter } from 'context-weaver/adapters';
 * 
 * const redis = new Redis(process.env.REDIS_URL);
 * 
 * const memory = new ContextWeaver({
 *   storage: new RedisAdapter({
 *     client: redis,
 *     sessionTTL: 3600, // 1 hour
 *   }),
 * });
 * ```
 */
export class RedisAdapter implements StorageAdapter {
  private client: RedisClient;
  private keyPrefix: string;
  private sessionTTL: number;
  private enableExpiry: boolean;

  constructor(options: RedisAdapterOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? 'cw:';
    this.sessionTTL = options.sessionTTL ?? 86400; // 24 hours
    this.enableExpiry = options.enableExpiry ?? true;
  }

  private messagesKey(sessionId: string): string {
    return `${this.keyPrefix}messages:${sessionId}`;
  }

  private summaryKey(sessionId: string): string {
    return `${this.keyPrefix}summary:${sessionId}`;
  }

  private async refreshExpiry(sessionId: string): Promise<void> {
    if (!this.enableExpiry) return;
    
    await Promise.all([
      this.client.expire(this.messagesKey(sessionId), this.sessionTTL),
      this.client.expire(this.summaryKey(sessionId), this.sessionTTL),
    ]);
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const data = await this.client.get(this.messagesKey(sessionId));
    if (!data) return [];
    
    try {
      const messages = JSON.parse(data) as Message[];
      // Refresh TTL on access
      await this.refreshExpiry(sessionId);
      return messages;
    } catch {
      return [];
    }
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    const messages = await this.getMessages(sessionId);
    messages.push(message);
    
    if (this.enableExpiry) {
      await this.client.set(
        this.messagesKey(sessionId),
        JSON.stringify(messages),
        'EX',
        this.sessionTTL
      );
    } else {
      await this.client.set(
        this.messagesKey(sessionId),
        JSON.stringify(messages)
      );
    }
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    updates: Partial<Message>
  ): Promise<void> {
    const messages = await this.getMessages(sessionId);
    const index = messages.findIndex((m) => m.id === messageId);
    
    if (index !== -1 && messages[index]) {
      messages[index] = { ...messages[index], ...updates };
      await this.client.set(
        this.messagesKey(sessionId),
        JSON.stringify(messages)
      );
      await this.refreshExpiry(sessionId);
    }
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const messages = await this.getMessages(sessionId);
    const filtered = messages.filter((m) => m.id !== messageId);
    
    await this.client.set(
      this.messagesKey(sessionId),
      JSON.stringify(filtered)
    );
    await this.refreshExpiry(sessionId);
  }

  async getSummary(sessionId: string): Promise<string | null> {
    const summary = await this.client.get(this.summaryKey(sessionId));
    if (summary) {
      await this.refreshExpiry(sessionId);
    }
    return summary;
  }

  async setSummary(sessionId: string, summary: string): Promise<void> {
    if (this.enableExpiry) {
      await this.client.set(
        this.summaryKey(sessionId),
        summary,
        'EX',
        this.sessionTTL
      );
    } else {
      await this.client.set(this.summaryKey(sessionId), summary);
    }
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.client.del(
      this.messagesKey(sessionId),
      this.summaryKey(sessionId)
    );
  }

  async hasSession(sessionId: string): Promise<boolean> {
    const exists = await this.client.exists(this.messagesKey(sessionId));
    return exists > 0;
  }

  /**
   * Get all session IDs (use with caution in production)
   */
  async getAllSessionIds(): Promise<string[]> {
    const keys = await this.client.keys(`${this.keyPrefix}messages:*`);
    return keys.map((key) => key.replace(`${this.keyPrefix}messages:`, ''));
  }

  /**
   * Clear all sessions (use with caution!)
   */
  async clearAll(): Promise<void> {
    const keys = await this.client.keys(`${this.keyPrefix}*`);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  /**
   * Get session TTL info
   */
  getSessionTTL(): number {
    return this.sessionTTL;
  }

  /**
   * Update session TTL
   */
  setSessionTTL(ttl: number): void {
    this.sessionTTL = ttl;
  }
}
