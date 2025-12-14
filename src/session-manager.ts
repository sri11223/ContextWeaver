/**
 * Session Management for ContextWeaver
 * 
 * Handles session TTL (time-to-live), automatic cleanup,
 * session metadata, and lifecycle management.
 * 
 * @example
 * ```typescript
 * import { SessionManager } from 'context-weaver';
 * 
 * const sessions = new SessionManager(memory, {
 *   defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
 *   cleanupInterval: 60 * 60 * 1000,  // Check every hour
 * });
 * 
 * // Sessions auto-expire after TTL
 * await sessions.touch('session-1'); // Reset TTL
 * ```
 */

import type { SessionStats, Message } from './types.js';
import type { ContextWeaver } from './context-weaver.js';

/**
 * Session metadata
 */
export interface SessionMetadata {
  /** Session creation timestamp */
  createdAt: number;
  /** Last activity timestamp */
  lastActivityAt: number;
  /** Session expiry timestamp (null = never expires) */
  expiresAt: number | null;
  /** Custom user data */
  userData?: Record<string, unknown>;
  /** Session tags for categorization */
  tags?: string[];
  /** Session status */
  status: 'active' | 'idle' | 'expired';
}

/**
 * Session manager options
 */
export interface SessionManagerOptions {
  /** Default TTL for new sessions in milliseconds (null = never expires) */
  defaultTTL?: number | null;
  /** Cleanup interval in milliseconds (default: 1 hour) */
  cleanupInterval?: number;
  /** Whether to auto-start cleanup timer */
  autoCleanup?: boolean;
  /** Callback when session expires */
  onSessionExpired?: (sessionId: string, metadata: SessionMetadata) => void;
  /** Maximum idle time before marking as idle (default: 5 minutes) */
  idleThreshold?: number;
}

/**
 * Session list result
 */
export interface SessionListResult {
  sessionId: string;
  metadata: SessionMetadata;
  stats: SessionStats;
}

/**
 * SessionManager - Manages session lifecycle
 */
export class SessionManager {
  private memory: ContextWeaver;
  private sessions: Map<string, SessionMetadata> = new Map();
  private defaultTTL: number | null;
  private cleanupInterval: number;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private onSessionExpired?: (sessionId: string, metadata: SessionMetadata) => void;
  private idleThreshold: number;

  constructor(memory: ContextWeaver, options: SessionManagerOptions = {}) {
    this.memory = memory;
    this.defaultTTL = options.defaultTTL ?? null;
    this.cleanupInterval = options.cleanupInterval ?? 60 * 60 * 1000; // 1 hour
    this.onSessionExpired = options.onSessionExpired;
    this.idleThreshold = options.idleThreshold ?? 5 * 60 * 1000; // 5 minutes

    if (options.autoCleanup !== false) {
      this.startCleanup();
    }
  }

  /**
   * Create or initialize a session with metadata
   * 
   * @example
   * ```typescript
   * const metadata = await sessions.create('session-1', {
   *   ttl: 2 * 60 * 60 * 1000, // 2 hours
   *   userData: { userId: 'user-123' },
   *   tags: ['support', 'billing'],
   * });
   * ```
   */
  async create(
    sessionId: string,
    options: {
      ttl?: number | null;
      userData?: Record<string, unknown>;
      tags?: string[];
    } = {}
  ): Promise<SessionMetadata> {
    const now = Date.now();
    const ttl = options.ttl !== undefined ? options.ttl : this.defaultTTL;

    const metadata: SessionMetadata = {
      createdAt: now,
      lastActivityAt: now,
      expiresAt: ttl ? now + ttl : null,
      userData: options.userData,
      tags: options.tags,
      status: 'active',
    };

    this.sessions.set(sessionId, metadata);
    return metadata;
  }

  /**
   * Touch a session (reset TTL and update last activity)
   */
  async touch(sessionId: string, options: { ttl?: number } = {}): Promise<SessionMetadata | null> {
    let metadata = this.sessions.get(sessionId);
    
    if (!metadata) {
      // Check if session exists in storage
      const exists = await this.memory.hasSession(sessionId);
      if (!exists) return null;
      
      // Create metadata for existing session
      metadata = await this.create(sessionId);
    }

    const now = Date.now();
    metadata.lastActivityAt = now;
    metadata.status = 'active';

    // Update expiry
    const ttl = options.ttl ?? this.defaultTTL;
    if (ttl) {
      metadata.expiresAt = now + ttl;
    }

    this.sessions.set(sessionId, metadata);
    return metadata;
  }

  /**
   * Get session metadata
   */
  async get(sessionId: string): Promise<SessionMetadata | null> {
    const metadata = this.sessions.get(sessionId);
    if (metadata) {
      this.updateStatus(metadata);
      return metadata;
    }

    // Check if session exists in storage
    const exists = await this.memory.hasSession(sessionId);
    if (!exists) return null;

    // Create and return new metadata
    return this.create(sessionId);
  }

  /**
   * Update session metadata
   */
  async update(
    sessionId: string,
    updates: {
      userData?: Record<string, unknown>;
      tags?: string[];
      ttl?: number | null;
    }
  ): Promise<SessionMetadata | null> {
    let metadata = await this.get(sessionId);
    if (!metadata) return null;

    if (updates.userData) {
      metadata.userData = { ...metadata.userData, ...updates.userData };
    }
    if (updates.tags) {
      metadata.tags = updates.tags;
    }
    if (updates.ttl !== undefined) {
      metadata.expiresAt = updates.ttl ? Date.now() + updates.ttl : null;
    }

    this.sessions.set(sessionId, metadata);
    return metadata;
  }

  /**
   * Check if session is expired
   */
  isExpired(sessionId: string): boolean {
    const metadata = this.sessions.get(sessionId);
    if (!metadata) return false;
    if (!metadata.expiresAt) return false;
    return Date.now() > metadata.expiresAt;
  }

  /**
   * Check if session is idle
   */
  isIdle(sessionId: string): boolean {
    const metadata = this.sessions.get(sessionId);
    if (!metadata) return false;
    return Date.now() - metadata.lastActivityAt > this.idleThreshold;
  }

  /**
   * Get time until session expires (in milliseconds)
   */
  getTimeToLive(sessionId: string): number | null {
    const metadata = this.sessions.get(sessionId);
    if (!metadata || !metadata.expiresAt) return null;
    return Math.max(0, metadata.expiresAt - Date.now());
  }

  /**
   * Expire a session immediately
   */
  async expire(sessionId: string): Promise<boolean> {
    const metadata = this.sessions.get(sessionId);
    if (!metadata) return false;

    metadata.status = 'expired';
    metadata.expiresAt = Date.now() - 1;

    this.onSessionExpired?.(sessionId, metadata);
    await this.memory.clear(sessionId);
    this.sessions.delete(sessionId);

    return true;
  }

  /**
   * Get all sessions (optionally filtered)
   */
  async list(options: {
    status?: 'active' | 'idle' | 'expired';
    tags?: string[];
    limit?: number;
  } = {}): Promise<SessionListResult[]> {
    const results: SessionListResult[] = [];

    for (const [sessionId, metadata] of this.sessions) {
      this.updateStatus(metadata);

      // Filter by status
      if (options.status && metadata.status !== options.status) continue;

      // Filter by tags
      if (options.tags && options.tags.length > 0) {
        if (!metadata.tags || !options.tags.some(t => metadata.tags!.includes(t))) {
          continue;
        }
      }

      // Get stats
      const stats = await this.memory.getStats(sessionId);

      results.push({
        sessionId,
        metadata,
        stats,
      });

      if (options.limit && results.length >= options.limit) break;
    }

    return results;
  }

  /**
   * Get sessions by tag
   */
  async getByTag(tag: string): Promise<SessionListResult[]> {
    return this.list({ tags: [tag] });
  }

  /**
   * Get active session count
   */
  getActiveCount(): number {
    let count = 0;
    for (const metadata of this.sessions.values()) {
      this.updateStatus(metadata);
      if (metadata.status === 'active') count++;
    }
    return count;
  }

  /**
   * Get total session count
   */
  getTotalCount(): number {
    return this.sessions.size;
  }

  /**
   * Run cleanup of expired sessions
   */
  async cleanup(): Promise<{ expired: number; cleaned: string[] }> {
    const cleaned: string[] = [];
    const now = Date.now();

    for (const [sessionId, metadata] of this.sessions) {
      if (metadata.expiresAt && now > metadata.expiresAt) {
        this.onSessionExpired?.(sessionId, metadata);
        await this.memory.clear(sessionId);
        this.sessions.delete(sessionId);
        cleaned.push(sessionId);
      }
    }

    return {
      expired: cleaned.length,
      cleaned,
    };
  }

  /**
   * Start automatic cleanup timer
   */
  startCleanup(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(async () => {
      await this.cleanup();
    }, this.cleanupInterval);

    // Prevent timer from keeping process alive
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Stop automatic cleanup timer
   */
  stopCleanup(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }

  /**
   * Export all session data for backup
   */
  async exportAll(): Promise<Map<string, { metadata: SessionMetadata; messages: Message[] }>> {
    const exported = new Map<string, { metadata: SessionMetadata; messages: Message[] }>();

    for (const [sessionId, metadata] of this.sessions) {
      const messages = await this.memory.getMessages(sessionId);
      exported.set(sessionId, { metadata, messages });
    }

    return exported;
  }

  /**
   * Import session data from backup
   */
  async importSession(
    sessionId: string,
    data: { metadata: SessionMetadata; messages: Message[] }
  ): Promise<void> {
    // Store metadata
    this.sessions.set(sessionId, data.metadata);

    // Clear existing messages
    await this.memory.clear(sessionId);

    // Add messages
    for (const msg of data.messages) {
      await this.memory.add(sessionId, msg.role, msg.content, {
        pinned: msg.pinned,
        metadata: msg.metadata,
        importance: msg.importance,
      });
    }
  }

  /**
   * Update session status based on activity
   */
  private updateStatus(metadata: SessionMetadata): void {
    const now = Date.now();

    if (metadata.expiresAt && now > metadata.expiresAt) {
      metadata.status = 'expired';
    } else if (now - metadata.lastActivityAt > this.idleThreshold) {
      metadata.status = 'idle';
    } else {
      metadata.status = 'active';
    }
  }

  /**
   * Destroy manager (cleanup resources)
   */
  destroy(): void {
    this.stopCleanup();
    this.sessions.clear();
  }
}

/**
 * Create a session manager with common presets
 */
export function createSessionManager(
  memory: ContextWeaver,
  preset: 'development' | 'production' | 'aggressive' = 'production'
): SessionManager {
  const presets: Record<string, SessionManagerOptions> = {
    development: {
      defaultTTL: null, // Never expires
      autoCleanup: false,
    },
    production: {
      defaultTTL: 24 * 60 * 60 * 1000, // 24 hours
      cleanupInterval: 60 * 60 * 1000, // 1 hour
      idleThreshold: 30 * 60 * 1000, // 30 minutes
    },
    aggressive: {
      defaultTTL: 2 * 60 * 60 * 1000, // 2 hours
      cleanupInterval: 15 * 60 * 1000, // 15 minutes
      idleThreshold: 5 * 60 * 1000, // 5 minutes
    },
  };

  return new SessionManager(memory, presets[preset]);
}

/**
 * Session middleware for automatic touch on activity
 * 
 * @example
 * ```typescript
 * const sessionMiddleware = createSessionMiddleware(sessions);
 * 
 * // Wrap your memory operations
 * await sessionMiddleware.wrap(sessionId, async () => {
 *   await memory.add(sessionId, 'user', 'Hello');
 * });
 * ```
 */
export function createSessionMiddleware(sessions: SessionManager) {
  return {
    /**
     * Wrap an operation to auto-touch the session
     */
    async wrap<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
      // Touch before operation
      await sessions.touch(sessionId);
      
      // Execute operation
      const result = await operation();
      
      return result;
    },

    /**
     * Check if session is valid before operation
     */
    async validateAndWrap<T>(
      sessionId: string,
      operation: () => Promise<T>
    ): Promise<T> {
      if (sessions.isExpired(sessionId)) {
        throw new Error(`Session ${sessionId} has expired`);
      }

      return this.wrap(sessionId, operation);
    },
  };
}
