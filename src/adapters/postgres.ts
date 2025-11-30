import type { Message, StorageAdapter } from '../types.js';

/**
 * Configuration options for PostgresAdapter
 */
export interface PostgresAdapterOptions {
  /** Postgres client or pool instance */
  client: PostgresClient;
  /** Table name for messages (default: 'context_weaver_messages') */
  messagesTable?: string;
  /** Table name for summaries (default: 'context_weaver_summaries') */
  summariesTable?: string;
  /** Enable automatic session expiry (default: true) */
  enableExpiry?: boolean;
  /** Session TTL in seconds (default: 86400 = 24 hours) */
  sessionTTL?: number;
}

/**
 * Minimal Postgres client interface
 * Compatible with pg, postgres.js, and @vercel/postgres
 */
export interface PostgresClient {
  query<T = unknown>(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: T[]; rowCount: number }>;
}

/**
 * PostgreSQL Storage Adapter for Production
 * 
 * Features:
 * - ACID compliant persistent storage
 * - Automatic table creation
 * - Session expiry with scheduled cleanup
 * - Efficient indexing
 * 
 * Required Tables (auto-created):
 * ```sql
 * CREATE TABLE IF NOT EXISTS context_weaver_messages (
 *   id SERIAL PRIMARY KEY,
 *   session_id VARCHAR(255) NOT NULL,
 *   message_id VARCHAR(255) NOT NULL,
 *   role VARCHAR(50) NOT NULL,
 *   content TEXT NOT NULL,
 *   timestamp BIGINT NOT NULL,
 *   pinned BOOLEAN DEFAULT FALSE,
 *   metadata JSONB,
 *   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 *   expires_at TIMESTAMP,
 *   UNIQUE(session_id, message_id)
 * );
 * 
 * CREATE INDEX idx_session_id ON context_weaver_messages(session_id);
 * CREATE INDEX idx_expires_at ON context_weaver_messages(expires_at);
 * ```
 * 
 * @example
 * ```ts
 * import { Pool } from 'pg';
 * import { ContextWeaver } from 'context-weaver';
 * import { PostgresAdapter } from 'context-weaver/adapters';
 * 
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * 
 * const adapter = new PostgresAdapter({ client: pool });
 * await adapter.initialize(); // Creates tables if not exist
 * 
 * const memory = new ContextWeaver({ storage: adapter });
 * ```
 */
export class PostgresAdapter implements StorageAdapter {
  private client: PostgresClient;
  private messagesTable: string;
  private summariesTable: string;
  private enableExpiry: boolean;
  private sessionTTL: number;
  private initialized: boolean = false;

  constructor(options: PostgresAdapterOptions) {
    this.client = options.client;
    this.messagesTable = options.messagesTable ?? 'context_weaver_messages';
    this.summariesTable = options.summariesTable ?? 'context_weaver_summaries';
    this.enableExpiry = options.enableExpiry ?? true;
    this.sessionTTL = options.sessionTTL ?? 86400;
  }

  /**
   * Initialize the database tables
   * Call this once before using the adapter
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Create messages table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.messagesTable} (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) NOT NULL,
        message_id VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        timestamp BIGINT NOT NULL,
        pinned BOOLEAN DEFAULT FALSE,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP,
        UNIQUE(session_id, message_id)
      )
    `);

    // Create indexes for performance
    await this.client.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.messagesTable}_session_id 
      ON ${this.messagesTable}(session_id)
    `);

    await this.client.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.messagesTable}_expires_at 
      ON ${this.messagesTable}(expires_at)
    `);

    // Create summaries table
    await this.client.query(`
      CREATE TABLE IF NOT EXISTS ${this.summariesTable} (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255) UNIQUE NOT NULL,
        summary TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      )
    `);

    await this.client.query(`
      CREATE INDEX IF NOT EXISTS idx_${this.summariesTable}_session_id 
      ON ${this.summariesTable}(session_id)
    `);

    this.initialized = true;
  }

  private getExpiresAt(): Date | null {
    if (!this.enableExpiry) return null;
    return new Date(Date.now() + this.sessionTTL * 1000);
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const query = this.enableExpiry
      ? `SELECT * FROM ${this.messagesTable} 
         WHERE session_id = $1 AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY timestamp ASC`
      : `SELECT * FROM ${this.messagesTable} 
         WHERE session_id = $1 
         ORDER BY timestamp ASC`;

    const result = await this.client.query<{
      message_id: string;
      role: string;
      content: string;
      timestamp: string;
      pinned: boolean;
      metadata: Record<string, unknown> | null;
    }>(query, [sessionId]);

    return result.rows.map((row) => ({
      id: row.message_id,
      role: row.role as Message['role'],
      content: row.content,
      timestamp: parseInt(row.timestamp, 10),
      pinned: row.pinned,
      metadata: row.metadata ?? undefined,
    }));
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    const expiresAt = this.getExpiresAt();

    await this.client.query(
      `INSERT INTO ${this.messagesTable} 
       (session_id, message_id, role, content, timestamp, pinned, metadata, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (session_id, message_id) 
       DO UPDATE SET content = $4, pinned = $6, metadata = $7, expires_at = $8`,
      [
        sessionId,
        message.id,
        message.role,
        message.content,
        message.timestamp,
        message.pinned ?? false,
        message.metadata ? JSON.stringify(message.metadata) : null,
        expiresAt,
      ]
    );

    // Update expiry for all messages in session
    if (this.enableExpiry) {
      await this.refreshSessionExpiry(sessionId);
    }
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    updates: Partial<Message>
  ): Promise<void> {
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`);
      values.push(updates.content);
    }
    if (updates.pinned !== undefined) {
      setClauses.push(`pinned = $${paramIndex++}`);
      values.push(updates.pinned);
    }
    if (updates.metadata !== undefined) {
      setClauses.push(`metadata = $${paramIndex++}`);
      values.push(JSON.stringify(updates.metadata));
    }

    if (setClauses.length === 0) return;

    values.push(sessionId, messageId);

    await this.client.query(
      `UPDATE ${this.messagesTable} 
       SET ${setClauses.join(', ')}
       WHERE session_id = $${paramIndex++} AND message_id = $${paramIndex}`,
      values
    );
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.client.query(
      `DELETE FROM ${this.messagesTable} 
       WHERE session_id = $1 AND message_id = $2`,
      [sessionId, messageId]
    );
  }

  async getSummary(sessionId: string): Promise<string | null> {
    const query = this.enableExpiry
      ? `SELECT summary FROM ${this.summariesTable} 
         WHERE session_id = $1 AND (expires_at IS NULL OR expires_at > NOW())`
      : `SELECT summary FROM ${this.summariesTable} WHERE session_id = $1`;

    const result = await this.client.query<{ summary: string }>(query, [sessionId]);

    return result.rows[0]?.summary ?? null;
  }

  async setSummary(sessionId: string, summary: string): Promise<void> {
    const expiresAt = this.getExpiresAt();

    await this.client.query(
      `INSERT INTO ${this.summariesTable} (session_id, summary, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id) 
       DO UPDATE SET summary = $2, updated_at = CURRENT_TIMESTAMP, expires_at = $3`,
      [sessionId, summary, expiresAt]
    );
  }

  async clearSession(sessionId: string): Promise<void> {
    await Promise.all([
      this.client.query(
        `DELETE FROM ${this.messagesTable} WHERE session_id = $1`,
        [sessionId]
      ),
      this.client.query(
        `DELETE FROM ${this.summariesTable} WHERE session_id = $1`,
        [sessionId]
      ),
    ]);
  }

  async hasSession(sessionId: string): Promise<boolean> {
    const result = await this.client.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ${this.messagesTable} WHERE session_id = $1`,
      [sessionId]
    );
    return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
  }

  /**
   * Refresh expiry for all messages in a session
   */
  private async refreshSessionExpiry(sessionId: string): Promise<void> {
    const expiresAt = this.getExpiresAt();
    
    await Promise.all([
      this.client.query(
        `UPDATE ${this.messagesTable} SET expires_at = $1 WHERE session_id = $2`,
        [expiresAt, sessionId]
      ),
      this.client.query(
        `UPDATE ${this.summariesTable} SET expires_at = $1 WHERE session_id = $2`,
        [expiresAt, sessionId]
      ),
    ]);
  }

  /**
   * Clean up expired sessions
   * Run this periodically (e.g., via cron job)
   */
  async cleanupExpired(): Promise<{ deletedMessages: number; deletedSummaries: number }> {
    const [messagesResult, summariesResult] = await Promise.all([
      this.client.query(
        `DELETE FROM ${this.messagesTable} WHERE expires_at IS NOT NULL AND expires_at < NOW()`
      ),
      this.client.query(
        `DELETE FROM ${this.summariesTable} WHERE expires_at IS NOT NULL AND expires_at < NOW()`
      ),
    ]);

    return {
      deletedMessages: messagesResult.rowCount,
      deletedSummaries: summariesResult.rowCount,
    };
  }

  /**
   * Get session statistics
   */
  async getStats(): Promise<{
    totalSessions: number;
    totalMessages: number;
    totalSummaries: number;
  }> {
    const [sessions, messages, summaries] = await Promise.all([
      this.client.query<{ count: string }>(
        `SELECT COUNT(DISTINCT session_id) as count FROM ${this.messagesTable}`
      ),
      this.client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM ${this.messagesTable}`
      ),
      this.client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM ${this.summariesTable}`
      ),
    ]);

    return {
      totalSessions: parseInt(sessions.rows[0]?.count ?? '0', 10),
      totalMessages: parseInt(messages.rows[0]?.count ?? '0', 10),
      totalSummaries: parseInt(summaries.rows[0]?.count ?? '0', 10),
    };
  }
}
