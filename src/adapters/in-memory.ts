import type { Message, StorageAdapter } from '../types.js';

/**
 * In-memory storage adapter for development and testing.
 * 
 * ⚠️ WARNING: Data is lost when the process restarts.
 * Use Redis or another persistent adapter for production.
 * 
 * @example
 * ```ts
 * const weaver = new ContextWeaver({
 *   storage: new InMemoryAdapter()
 * });
 * ```
 */
export class InMemoryAdapter implements StorageAdapter {
  private sessions: Map<string, Message[]> = new Map();
  private summaries: Map<string, string> = new Map();

  async getMessages(sessionId: string): Promise<Message[]> {
    return this.sessions.get(sessionId) ?? [];
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    const messages = this.sessions.get(sessionId) ?? [];
    messages.push(message);
    this.sessions.set(sessionId, messages);
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    updates: Partial<Message>
  ): Promise<void> {
    const messages = this.sessions.get(sessionId);
    if (!messages) return;

    const index = messages.findIndex((m) => m.id === messageId);
    if (index !== -1) {
      messages[index] = { ...messages[index]!, ...updates };
    }
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const messages = this.sessions.get(sessionId);
    if (!messages) return;

    const index = messages.findIndex((m) => m.id === messageId);
    if (index !== -1) {
      messages.splice(index, 1);
    }
  }

  async getSummary(sessionId: string): Promise<string | null> {
    return this.summaries.get(sessionId) ?? null;
  }

  async setSummary(sessionId: string, summary: string): Promise<void> {
    this.summaries.set(sessionId, summary);
  }

  async clearSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.summaries.delete(sessionId);
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return this.sessions.has(sessionId);
  }

  /**
   * Clear all sessions (useful for testing)
   */
  clearAll(): void {
    this.sessions.clear();
    this.summaries.clear();
  }

  /**
   * Get all session IDs (useful for debugging)
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}
