import { describe, it, expect, beforeEach } from 'vitest';
import {
  CompressedStorageAdapter,
  ContentDeduplicator,
  createCompressedAdapter,
  estimateMemorySize,
  formatBytes,
  type Message,
  type StorageAdapter,
} from '../src/index.js';

// Mock storage adapter for testing
class MockStorageAdapter implements StorageAdapter {
  private storage = new Map<string, Message[]>();
  private summaries = new Map<string, string>();

  async addMessage(sessionId: string, message: Message): Promise<void> {
    const messages = this.storage.get(sessionId) || [];
    messages.push(message);
    this.storage.set(sessionId, messages);
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    return this.storage.get(sessionId) || [];
  }

  async updateMessage(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    const messages = this.storage.get(sessionId) || [];
    const index = messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      messages[index] = { ...messages[index], ...updates };
    }
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const messages = this.storage.get(sessionId) || [];
    const filtered = messages.filter(m => m.id !== messageId);
    this.storage.set(sessionId, filtered);
  }

  async getSummary(sessionId: string): Promise<string | null> {
    return this.summaries.get(sessionId) ?? null;
  }

  async setSummary(sessionId: string, summary: string): Promise<void> {
    this.summaries.set(sessionId, summary);
  }

  async clearSession(sessionId: string): Promise<void> {
    this.storage.delete(sessionId);
    this.summaries.delete(sessionId);
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return this.storage.has(sessionId);
  }
}

describe('CompressedStorageAdapter', () => {
  let mockStorage: MockStorageAdapter;
  let compressedAdapter: CompressedStorageAdapter;

  beforeEach(() => {
    mockStorage = new MockStorageAdapter();
    compressedAdapter = new CompressedStorageAdapter(mockStorage, {
      strategy: 'simple',
      threshold: 10, // Low threshold for testing
    });
  });

  describe('constructor', () => {
    it('should create with default options', () => {
      const adapter = new CompressedStorageAdapter(mockStorage);
      expect(adapter).toBeInstanceOf(CompressedStorageAdapter);
    });

    it('should create with custom options', () => {
      const adapter = new CompressedStorageAdapter(mockStorage, {
        strategy: 'none',
        threshold: 1000,
      });
      expect(adapter).toBeInstanceOf(CompressedStorageAdapter);
    });

    it('should accept custom compressor functions', () => {
      const adapter = new CompressedStorageAdapter(mockStorage, {
        compressor: (text) => text.toUpperCase(),
        decompressor: (text) => text.toLowerCase(),
      });
      expect(adapter).toBeInstanceOf(CompressedStorageAdapter);
    });
  });

  describe('addMessage', () => {
    it('should add a simple message', async () => {
      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello',
        timestamp: Date.now(),
      };

      await compressedAdapter.addMessage('session-1', message);
      const messages = await compressedAdapter.getMessages('session-1');
      
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Hello');
    });

    it('should handle long content with compression', async () => {
      const longContent = 'A'.repeat(1000);
      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: longContent,
        timestamp: Date.now(),
      };

      await compressedAdapter.addMessage('session-1', message);
      const messages = await compressedAdapter.getMessages('session-1');
      
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe(longContent);
    });

    it('should compress content with repeated patterns', async () => {
      // Content with lots of newlines and spaces should compress well
      const contentWithPatterns = 'Hello\n\n\n\n\n\nWorld   .....End';
      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: contentWithPatterns,
        timestamp: Date.now(),
      };

      await compressedAdapter.addMessage('session-1', message);
      const messages = await compressedAdapter.getMessages('session-1');
      
      expect(messages[0].content).toBe(contentWithPatterns);
    });
  });

  describe('getMessages', () => {
    it('should return empty array for non-existent session', async () => {
      const messages = await compressedAdapter.getMessages('non-existent');
      expect(messages).toEqual([]);
    });

    it('should decompress messages on retrieval', async () => {
      const content = 'Test\n\n\n\n\nMore text   with spaces';
      const message: Message = {
        id: 'msg-1',
        role: 'assistant',
        content,
        timestamp: Date.now(),
      };

      await compressedAdapter.addMessage('session-1', message);
      const messages = await compressedAdapter.getMessages('session-1');
      
      expect(messages[0].content).toBe(content);
    });

    it('should preserve message metadata', async () => {
      const message: Message = {
        id: 'msg-1',
        role: 'user',
        content: 'Test',
        timestamp: 1234567890,
        metadata: { custom: 'value' },
      };

      await compressedAdapter.addMessage('session-1', message);
      const messages = await compressedAdapter.getMessages('session-1');
      
      expect(messages[0].id).toBe('msg-1');
      expect(messages[0].role).toBe('user');
      expect(messages[0].timestamp).toBe(1234567890);
      expect(messages[0].metadata).toEqual({ custom: 'value' });
    });
  });

  describe('clearSession', () => {
    it('should clear all messages for a session', async () => {
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content: 'Test',
        timestamp: Date.now(),
      });

      await compressedAdapter.clearSession('session-1');
      const messages = await compressedAdapter.getMessages('session-1');
      
      expect(messages).toEqual([]);
    });
  });

  describe('updateMessage', () => {
    it('should update message content', async () => {
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content: 'Original',
        timestamp: Date.now(),
      });

      await compressedAdapter.updateMessage('session-1', 'msg-1', {
        content: 'Updated',
      });

      const messages = await compressedAdapter.getMessages('session-1');
      expect(messages[0].content).toBe('Updated');
    });
  });

  describe('deleteMessage', () => {
    it('should delete a specific message', async () => {
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content: 'First',
        timestamp: Date.now(),
      });
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-2',
        role: 'assistant',
        content: 'Second',
        timestamp: Date.now(),
      });

      await compressedAdapter.deleteMessage('session-1', 'msg-1');
      const messages = await compressedAdapter.getMessages('session-1');
      
      expect(messages).toHaveLength(1);
      expect(messages[0].id).toBe('msg-2');
    });
  });

  describe('summary methods', () => {
    it('should compress and decompress summaries', async () => {
      const summary = 'This is a summary\n\n\n\nwith   patterns';
      await compressedAdapter.setSummary('session-1', summary);
      
      const retrieved = await compressedAdapter.getSummary('session-1');
      expect(retrieved).toBe(summary);
    });

    it('should return null for non-existent summary', async () => {
      const summary = await compressedAdapter.getSummary('non-existent');
      expect(summary).toBeNull();
    });
  });

  describe('hasSession', () => {
    it('should return true for existing session', async () => {
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content: 'Test',
        timestamp: Date.now(),
      });

      const exists = await compressedAdapter.hasSession('session-1');
      expect(exists).toBe(true);
    });

    it('should return false for non-existent session', async () => {
      const exists = await compressedAdapter.hasSession('non-existent');
      expect(exists).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return compression statistics', async () => {
      // Add messages with varying content
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content: 'Short',
        timestamp: Date.now(),
      });
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-2',
        role: 'assistant',
        content: 'Longer message\n\n\n\n\n\nwith   patterns',
        timestamp: Date.now(),
      });

      const stats = compressedAdapter.getStats();
      
      expect(stats.totalMessages).toBe(2);
      expect(stats.originalSize).toBeGreaterThan(0);
      expect(stats.compressedSize).toBeGreaterThan(0);
      expect(typeof stats.ratio).toBe('number');
    });

    it('should track space saved', async () => {
      const contentWithPatterns = 'Text\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nMore text';
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content: contentWithPatterns,
        timestamp: Date.now(),
      });

      const stats = compressedAdapter.getStats();
      expect(stats.spaceSaved).toBeGreaterThanOrEqual(0);
    });
  });

  describe('resetStats', () => {
    it('should reset statistics', async () => {
      await compressedAdapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content: 'Test message',
        timestamp: Date.now(),
      });

      compressedAdapter.resetStats();
      const stats = compressedAdapter.getStats();
      
      expect(stats.totalMessages).toBe(0);
      expect(stats.compressedMessages).toBe(0);
      expect(stats.originalSize).toBe(0);
    });
  });
});

describe('Compression Strategies', () => {
  let mockStorage: MockStorageAdapter;

  beforeEach(() => {
    mockStorage = new MockStorageAdapter();
  });

  describe('simple strategy', () => {
    it('should compress and decompress correctly', async () => {
      const adapter = new CompressedStorageAdapter(mockStorage, {
        strategy: 'simple',
        threshold: 10,
      });

      const content = 'Hello\n\n\n\n\n\n\n\nWorld   with spaces.....end';
      await adapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content,
        timestamp: Date.now(),
      });

      const messages = await adapter.getMessages('session-1');
      expect(messages[0].content).toBe(content);
    });

    it('should compress patterns with newlines', async () => {
      const adapter = new CompressedStorageAdapter(mockStorage, {
        strategy: 'simple',
        threshold: 10,
      });

      const content = 'A\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\n\nB';
      await adapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content,
        timestamp: Date.now(),
      });

      const stats = adapter.getStats();
      expect(stats.totalMessages).toBe(1);
    });
  });

  describe('none strategy', () => {
    it('should not modify content', async () => {
      const adapter = new CompressedStorageAdapter(mockStorage, {
        strategy: 'none',
      });

      const content = 'Original content stays the same\n\n\n\n';
      await adapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content,
        timestamp: Date.now(),
      });

      const messages = await adapter.getMessages('session-1');
      expect(messages[0].content).toBe(content);
    });
  });

  describe('custom strategy', () => {
    it('should use custom compressor/decompressor', async () => {
      const adapter = new CompressedStorageAdapter(mockStorage, {
        compressor: (text) => `COMPRESSED:${text}`,
        decompressor: (text) => text.replace('COMPRESSED:', ''),
        threshold: 0,
      });

      const content = 'Test content';
      await adapter.addMessage('session-1', {
        id: 'msg-1',
        role: 'user',
        content,
        timestamp: Date.now(),
      });

      const messages = await adapter.getMessages('session-1');
      expect(messages[0].content).toBe(content);
    });
  });
});

describe('ContentDeduplicator', () => {
  let deduplicator: ContentDeduplicator;

  beforeEach(() => {
    deduplicator = new ContentDeduplicator();
  });

  describe('constructor', () => {
    it('should create deduplicator', () => {
      expect(deduplicator).toBeInstanceOf(ContentDeduplicator);
    });
  });

  describe('register and expand', () => {
    it('should register and expand patterns', () => {
      const pattern = 'This is a repeated pattern';
      const key = deduplicator.register(pattern);
      
      expect(typeof key).toBe('string');
      expect(key).toContain('__dup_');
      
      const expanded = deduplicator.expand(key);
      expect(expanded).toBe(pattern);
    });

    it('should return same key for same pattern', () => {
      const pattern = 'Duplicate pattern';
      const key1 = deduplicator.register(pattern);
      const key2 = deduplicator.register(pattern);
      
      expect(key1).toBe(key2);
    });

    it('should return different keys for different patterns', () => {
      const key1 = deduplicator.register('Pattern A');
      const key2 = deduplicator.register('Pattern B');
      
      expect(key1).not.toBe(key2);
    });

    it('should return undefined for unknown key', () => {
      const result = deduplicator.expand('__unknown__');
      expect(result).toBeUndefined();
    });
  });

  describe('deduplicate and restore', () => {
    it('should deduplicate content', () => {
      const content = 'This is some content that will be deduplicated into chunks';
      const deduplicated = deduplicator.deduplicate(content, 20);
      
      // Should contain some keys
      expect(deduplicated).toBeTruthy();
    });

    it('should restore deduplicated content', () => {
      const content = 'This is some longer content that needs to be split up and then restored back';
      const deduplicated = deduplicator.deduplicate(content, 20);
      const restored = deduplicator.restore(deduplicated);
      
      // Should restore to original
      expect(restored).toBe(content);
    });
  });

  describe('size', () => {
    it('should return number of registered patterns', () => {
      expect(deduplicator.size()).toBe(0);
      
      deduplicator.register('Pattern 1');
      expect(deduplicator.size()).toBe(1);
      
      deduplicator.register('Pattern 2');
      expect(deduplicator.size()).toBe(2);
      
      // Same pattern shouldn't increase size
      deduplicator.register('Pattern 1');
      expect(deduplicator.size()).toBe(2);
    });
  });

  describe('clear', () => {
    it('should clear all patterns', () => {
      deduplicator.register('Pattern 1');
      deduplicator.register('Pattern 2');
      deduplicator.register('Pattern 3');
      
      expect(deduplicator.size()).toBe(3);
      
      deduplicator.clear();
      
      expect(deduplicator.size()).toBe(0);
    });
  });
});

describe('createCompressedAdapter', () => {
  let mockStorage: MockStorageAdapter;

  beforeEach(() => {
    mockStorage = new MockStorageAdapter();
  });

  it('should create with minimal preset', () => {
    const adapter = createCompressedAdapter(mockStorage, 'minimal');
    expect(adapter).toBeInstanceOf(CompressedStorageAdapter);
  });

  it('should create with balanced preset (default)', () => {
    const adapter = createCompressedAdapter(mockStorage);
    expect(adapter).toBeInstanceOf(CompressedStorageAdapter);
  });

  it('should create with aggressive preset', () => {
    const adapter = createCompressedAdapter(mockStorage, 'aggressive');
    expect(adapter).toBeInstanceOf(CompressedStorageAdapter);
  });
});

describe('estimateMemorySize', () => {
  it('should estimate size of messages array', () => {
    const messages: Message[] = [
      { id: 'msg-1', role: 'user', content: 'Hello', timestamp: Date.now() },
      { id: 'msg-2', role: 'assistant', content: 'Hi there!', timestamp: Date.now() },
    ];
    
    const size = estimateMemorySize(messages);
    expect(size).toBeGreaterThan(0);
  });

  it('should handle empty array', () => {
    const size = estimateMemorySize([]);
    expect(size).toBe(0);
  });

  it('should include metadata in estimate', () => {
    const withMetadata: Message[] = [
      { 
        id: 'msg-1', 
        role: 'user', 
        content: 'Test',
        timestamp: Date.now(),
        metadata: { key: 'value', nested: { data: 'here' } },
      },
    ];
    const withoutMetadata: Message[] = [
      { id: 'msg-1', role: 'user', content: 'Test', timestamp: Date.now() },
    ];
    
    const sizeWith = estimateMemorySize(withMetadata);
    const sizeWithout = estimateMemorySize(withoutMetadata);
    
    expect(sizeWith).toBeGreaterThan(sizeWithout);
  });

  it('should scale with content length', () => {
    const short: Message[] = [
      { id: 'msg-1', role: 'user', content: 'Hi', timestamp: Date.now() },
    ];
    const long: Message[] = [
      { id: 'msg-1', role: 'user', content: 'A'.repeat(1000), timestamp: Date.now() },
    ];
    
    const shortSize = estimateMemorySize(short);
    const longSize = estimateMemorySize(long);
    
    expect(longSize).toBeGreaterThan(shortSize);
  });
});

describe('formatBytes', () => {
  it('should format bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(100)).toBe('100 B');
    expect(formatBytes(500)).toBe('500 B');
  });

  it('should format kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('should format megabytes', () => {
    expect(formatBytes(1048576)).toBe('1.00 MB');
    expect(formatBytes(2097152)).toBe('2.00 MB');
  });
});

describe('Integration Tests', () => {
  it('should handle large conversation with compression', async () => {
    const mockStorage = new MockStorageAdapter();
    const adapter = new CompressedStorageAdapter(mockStorage, {
      strategy: 'simple',
      threshold: 50,
    });

    // Add many messages with repeated patterns
    for (let i = 0; i < 50; i++) {
      await adapter.addMessage('session-1', {
        id: `msg-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}\n\n\n\n\nwith   patterns.....`,
        timestamp: Date.now() + i,
      });
    }

    const messages = await adapter.getMessages('session-1');
    expect(messages).toHaveLength(50);
    
    const stats = adapter.getStats();
    expect(stats.totalMessages).toBe(50);
  });

  it('should preserve special characters', async () => {
    const mockStorage = new MockStorageAdapter();
    const adapter = new CompressedStorageAdapter(mockStorage, {
      strategy: 'simple',
    });

    const specialContent = 'Special chars: 日本語 中文 🎉 émojis\n\ttabs\r\nand newlines';
    await adapter.addMessage('session-1', {
      id: 'msg-1',
      role: 'user',
      content: specialContent,
      timestamp: Date.now(),
    });

    const messages = await adapter.getMessages('session-1');
    expect(messages[0].content).toBe(specialContent);
  });

  it('should handle empty content', async () => {
    const mockStorage = new MockStorageAdapter();
    const adapter = new CompressedStorageAdapter(mockStorage);

    await adapter.addMessage('session-1', {
      id: 'msg-1',
      role: 'user',
      content: '',
      timestamp: Date.now(),
    });

    const messages = await adapter.getMessages('session-1');
    expect(messages[0].content).toBe('');
  });

  it('should handle § escape character', async () => {
    const mockStorage = new MockStorageAdapter();
    const adapter = new CompressedStorageAdapter(mockStorage, {
      strategy: 'simple',
    });

    const contentWithMarker = 'Test § content with § markers';
    await adapter.addMessage('session-1', {
      id: 'msg-1',
      role: 'user',
      content: contentWithMarker,
      timestamp: Date.now(),
    });

    const messages = await adapter.getMessages('session-1');
    expect(messages[0].content).toBe(contentWithMarker);
  });
});
