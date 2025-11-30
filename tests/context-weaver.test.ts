import { describe, it, expect, beforeEach } from 'vitest';
import { ContextWeaver } from '../src/context-weaver.js';
import { InMemoryAdapter } from '../src/adapters/in-memory.js';

describe('ContextWeaver', () => {
  let memory: ContextWeaver;

  beforeEach(() => {
    memory = new ContextWeaver({
      tokenLimit: 500,
      recentMessageCount: 5,
    });
  });

  describe('add()', () => {
    it('should add a message and return an ID', async () => {
      const id = await memory.add('session-1', 'user', 'Hello!');
      
      expect(id).toBeDefined();
      expect(id).toMatch(/^msg_/);
    });

    it('should add multiple messages', async () => {
      await memory.add('session-1', 'user', 'Message 1');
      await memory.add('session-1', 'assistant', 'Message 2');
      await memory.add('session-1', 'user', 'Message 3');

      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(3);
    });

    it('should add pinned messages', async () => {
      await memory.add('session-1', 'system', 'System prompt', { pinned: true });
      
      const messages = await memory.getMessages('session-1');
      expect(messages[0]?.pinned).toBe(true);
    });

    it('should add messages with metadata', async () => {
      await memory.add('session-1', 'user', 'Search', { 
        metadata: { intent: 'search' } 
      });
      
      const messages = await memory.getMessages('session-1');
      expect(messages[0]?.metadata).toEqual({ intent: 'search' });
    });
  });

  describe('getContext()', () => {
    it('should return messages within token limit', async () => {
      // Add many messages
      for (let i = 0; i < 20; i++) {
        await memory.add('session-1', 'user', `This is message number ${i} with some content to use tokens.`);
      }

      const context = await memory.getContext('session-1', { maxTokens: 200 });
      
      expect(context.tokenCount).toBeLessThanOrEqual(200);
      expect(context.messages.length).toBeLessThan(20);
    });

    it('should return LLM-compatible message format', async () => {
      await memory.add('session-1', 'user', 'Hello');
      await memory.add('session-1', 'assistant', 'Hi there!');

      const context = await memory.getContext('session-1');
      
      expect(context.messages[0]).toEqual({
        role: 'user',
        content: 'Hello',
      });
    });

    it('should include pinned messages', async () => {
      await memory.add('session-1', 'system', 'Important system prompt', { pinned: true });
      
      // Add many messages to exceed token limit
      for (let i = 0; i < 20; i++) {
        await memory.add('session-1', 'user', `Message ${i}`);
      }

      const context = await memory.getContext('session-1', { maxTokens: 100 });
      
      // The pinned message should still be included
      const hasSystemMessage = context.messages.some(
        m => m.role === 'system' && m.content.includes('Important')
      );
      expect(hasSystemMessage).toBe(true);
      expect(context.pinnedCount).toBe(1);
    });

    it('should return recent messages when no token limit issue', async () => {
      await memory.add('session-1', 'user', 'First');
      await memory.add('session-1', 'assistant', 'Second');
      await memory.add('session-1', 'user', 'Third');

      const context = await memory.getContext('session-1');
      
      expect(context.messages).toHaveLength(3);
      expect(context.messages[0]?.content).toBe('First');
      expect(context.messages[2]?.content).toBe('Third');
    });
  });

  describe('pin() and unpin()', () => {
    it('should pin a message', async () => {
      const id = await memory.add('session-1', 'user', 'Important info');
      await memory.pin('session-1', id);

      const messages = await memory.getMessages('session-1');
      expect(messages[0]?.pinned).toBe(true);
    });

    it('should unpin a message', async () => {
      const id = await memory.add('session-1', 'user', 'Info', { pinned: true });
      await memory.unpin('session-1', id);

      const messages = await memory.getMessages('session-1');
      expect(messages[0]?.pinned).toBe(false);
    });
  });

  describe('getStats()', () => {
    it('should return accurate statistics', async () => {
      await memory.add('session-1', 'user', 'Hello', { pinned: true });
      await memory.add('session-1', 'assistant', 'Hi!');
      await memory.add('session-1', 'user', 'How are you?');

      const stats = await memory.getStats('session-1');
      
      expect(stats.totalMessages).toBe(3);
      expect(stats.pinnedMessages).toBe(1);
      expect(stats.estimatedTokens).toBeGreaterThan(0);
      expect(stats.hasSummary).toBe(false);
    });
  });

  describe('clear()', () => {
    it('should clear all messages for a session', async () => {
      await memory.add('session-1', 'user', 'Message 1');
      await memory.add('session-1', 'user', 'Message 2');
      
      await memory.clear('session-1');
      
      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(0);
    });

    it('should not affect other sessions', async () => {
      await memory.add('session-1', 'user', 'Session 1 message');
      await memory.add('session-2', 'user', 'Session 2 message');
      
      await memory.clear('session-1');
      
      const session1 = await memory.getMessages('session-1');
      const session2 = await memory.getMessages('session-2');
      
      expect(session1).toHaveLength(0);
      expect(session2).toHaveLength(1);
    });
  });

  describe('hasSession()', () => {
    it('should return true for existing session', async () => {
      await memory.add('session-1', 'user', 'Hello');
      
      expect(await memory.hasSession('session-1')).toBe(true);
    });

    it('should return false for non-existing session', async () => {
      expect(await memory.hasSession('non-existent')).toBe(false);
    });
  });

  describe('summarize()', () => {
    it('should call summarizer and store summary', async () => {
      const mockSummarizer = async () => 'This is a summary';
      
      const memoryWithSummarizer = new ContextWeaver({
        tokenLimit: 500,
        recentMessageCount: 2,
        summarizer: mockSummarizer,
      });

      // Add enough messages
      for (let i = 0; i < 10; i++) {
        await memoryWithSummarizer.add('session-1', 'user', `Message ${i}`);
      }

      const summary = await memoryWithSummarizer.summarize('session-1');
      
      expect(summary).toBe('This is a summary');
    });

    it('should include summary in context', async () => {
      const mockSummarizer = async () => 'Previous discussion about travel';
      
      const memoryWithSummarizer = new ContextWeaver({
        tokenLimit: 500,
        recentMessageCount: 2,
        summarizer: mockSummarizer,
      });

      for (let i = 0; i < 10; i++) {
        await memoryWithSummarizer.add('session-1', 'user', `Message ${i}`);
      }

      await memoryWithSummarizer.summarize('session-1');
      
      const context = await memoryWithSummarizer.getContext('session-1');
      
      expect(context.wasSummarized).toBe(true);
      const hasSummary = context.messages.some(
        m => m.content.includes('Previous discussion about travel')
      );
      expect(hasSummary).toBe(true);
    });

    it('should return null if no summarizer configured', async () => {
      await memory.add('session-1', 'user', 'Hello');
      
      const result = await memory.summarize('session-1');
      
      expect(result).toBeNull();
    });
  });
});

describe('InMemoryAdapter', () => {
  let adapter: InMemoryAdapter;

  beforeEach(() => {
    adapter = new InMemoryAdapter();
  });

  it('should store and retrieve messages', async () => {
    const message = {
      id: 'msg-1',
      role: 'user' as const,
      content: 'Hello',
      timestamp: Date.now(),
    };

    await adapter.addMessage('session-1', message);
    const messages = await adapter.getMessages('session-1');

    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual(message);
  });

  it('should update messages', async () => {
    const message = {
      id: 'msg-1',
      role: 'user' as const,
      content: 'Hello',
      timestamp: Date.now(),
    };

    await adapter.addMessage('session-1', message);
    await adapter.updateMessage('session-1', 'msg-1', { pinned: true });
    
    const messages = await adapter.getMessages('session-1');
    expect(messages[0]?.pinned).toBe(true);
  });

  it('should delete messages', async () => {
    const message = {
      id: 'msg-1',
      role: 'user' as const,
      content: 'Hello',
      timestamp: Date.now(),
    };

    await adapter.addMessage('session-1', message);
    await adapter.deleteMessage('session-1', 'msg-1');
    
    const messages = await adapter.getMessages('session-1');
    expect(messages).toHaveLength(0);
  });

  it('should handle summaries', async () => {
    await adapter.setSummary('session-1', 'Test summary');
    const summary = await adapter.getSummary('session-1');
    
    expect(summary).toBe('Test summary');
  });

  it('should clear sessions completely', async () => {
    const message = {
      id: 'msg-1',
      role: 'user' as const,
      content: 'Hello',
      timestamp: Date.now(),
    };

    await adapter.addMessage('session-1', message);
    await adapter.setSummary('session-1', 'Summary');
    await adapter.clearSession('session-1');
    
    const messages = await adapter.getMessages('session-1');
    const summary = await adapter.getSummary('session-1');
    
    expect(messages).toHaveLength(0);
    expect(summary).toBeNull();
  });
});
