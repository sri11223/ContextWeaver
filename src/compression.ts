/**
 * Message Compression for ContextWeaver
 * 
 * Reduces storage size by compressing message content.
 * Supports multiple compression strategies.
 * 
 * @example
 * ```typescript
 * import { CompressedStorageAdapter } from 'context-weaver';
 * 
 * const storage = new CompressedStorageAdapter(baseAdapter, {
 *   strategy: 'lz-string', // or 'simple', 'none'
 *   threshold: 100, // Only compress messages > 100 chars
 * });
 * 
 * const memory = new ContextWeaver({ storage });
 * ```
 */

import type { Message, StorageAdapter } from './types.js';

/**
 * Compression strategy type
 */
export type CompressionStrategy = 'simple' | 'none';

/**
 * Compression options
 */
export interface CompressionOptions {
  /** Compression strategy to use */
  strategy?: CompressionStrategy;
  /** Minimum content length to compress (default: 100) */
  threshold?: number;
  /** Custom compressor function */
  compressor?: (text: string) => string;
  /** Custom decompressor function */
  decompressor?: (text: string) => string;
}

/**
 * Compression statistics
 */
export interface CompressionStats {
  /** Total messages processed */
  totalMessages: number;
  /** Messages that were compressed */
  compressedMessages: number;
  /** Original size in bytes */
  originalSize: number;
  /** Compressed size in bytes */
  compressedSize: number;
  /** Compression ratio (0-1, lower is better) */
  ratio: number;
  /** Space saved in bytes */
  spaceSaved: number;
}

/**
 * Compressed message wrapper
 */
interface CompressedMessage extends Message {
  __compressed?: boolean;
  __originalLength?: number;
}

/**
 * Simple run-length encoding for repeated characters/patterns
 */
function simpleCompress(text: string): string {
  // Escape existing markers
  let result = text.replace(/§/g, '§§');
  
  // Compress common patterns
  const patterns = [
    [/\n\n+/g, (m: string) => `§n${m.length}§`],
    [/ {3,}/g, (m: string) => `§s${m.length}§`],
    [/\.{3,}/g, (m: string) => `§.${m.length}§`],
  ] as const;

  for (const [pattern, replacer] of patterns) {
    result = result.replace(pattern, replacer as (m: string) => string);
  }

  return result;
}

/**
 * Decompress simple RLE
 */
function simpleDecompress(text: string): string {
  let result = text;

  // Decompress patterns
  result = result.replace(/§n(\d+)§/g, (_, n) => '\n'.repeat(parseInt(n)));
  result = result.replace(/§s(\d+)§/g, (_, n) => ' '.repeat(parseInt(n)));
  result = result.replace(/§\.(\d+)§/g, (_, n) => '.'.repeat(parseInt(n)));
  
  // Unescape markers
  result = result.replace(/§§/g, '§');

  return result;
}

/**
 * CompressedStorageAdapter - Wraps a storage adapter with compression
 */
export class CompressedStorageAdapter implements StorageAdapter {
  private adapter: StorageAdapter;
  private strategy: CompressionStrategy;
  private threshold: number;
  private compressor: (text: string) => string;
  private decompressor: (text: string) => string;
  private stats: CompressionStats = {
    totalMessages: 0,
    compressedMessages: 0,
    originalSize: 0,
    compressedSize: 0,
    ratio: 1,
    spaceSaved: 0,
  };

  constructor(adapter: StorageAdapter, options: CompressionOptions = {}) {
    this.adapter = adapter;
    this.strategy = options.strategy ?? 'simple';
    this.threshold = options.threshold ?? 100;

    // Set up compressor/decompressor based on strategy
    if (options.compressor && options.decompressor) {
      this.compressor = options.compressor;
      this.decompressor = options.decompressor;
    } else {
      switch (this.strategy) {
        case 'simple':
          this.compressor = simpleCompress;
          this.decompressor = simpleDecompress;
          break;
        case 'none':
        default:
          this.compressor = (t) => t;
          this.decompressor = (t) => t;
      }
    }
  }

  /**
   * Compress a message if it meets threshold
   */
  private compress(message: Message): CompressedMessage {
    const content = message.content;
    const originalLength = content.length;

    this.stats.totalMessages++;
    this.stats.originalSize += originalLength;

    // Skip if below threshold
    if (originalLength < this.threshold) {
      this.stats.compressedSize += originalLength;
      return message;
    }

    // Compress
    const compressed = this.compressor(content);
    const compressedLength = compressed.length;

    // Only use compression if it actually reduces size
    if (compressedLength < originalLength) {
      this.stats.compressedMessages++;
      this.stats.compressedSize += compressedLength;
      this.stats.spaceSaved += originalLength - compressedLength;
      
      // Update ratio
      if (this.stats.originalSize > 0) {
        this.stats.ratio = this.stats.compressedSize / this.stats.originalSize;
      }

      return {
        ...message,
        content: compressed,
        __compressed: true,
        __originalLength: originalLength,
      };
    }

    // Compression didn't help, use original
    this.stats.compressedSize += originalLength;
    return message;
  }

  /**
   * Decompress a message if needed
   */
  private decompress(message: CompressedMessage): Message {
    if (!message.__compressed) {
      return message;
    }

    const { __compressed, __originalLength, ...rest } = message;
    return {
      ...rest,
      content: this.decompressor(message.content),
    };
  }

  /**
   * Get compression statistics
   */
  getStats(): CompressionStats {
    return { ...this.stats };
  }

  /**
   * Reset compression statistics
   */
  resetStats(): void {
    this.stats = {
      totalMessages: 0,
      compressedMessages: 0,
      originalSize: 0,
      compressedSize: 0,
      ratio: 1,
      spaceSaved: 0,
    };
  }

  // StorageAdapter implementation
  async getMessages(sessionId: string): Promise<Message[]> {
    const messages = await this.adapter.getMessages(sessionId);
    return messages.map(m => this.decompress(m as CompressedMessage));
  }

  async addMessage(sessionId: string, message: Message): Promise<void> {
    const compressed = this.compress(message);
    await this.adapter.addMessage(sessionId, compressed);
  }

  async updateMessage(
    sessionId: string,
    messageId: string,
    updates: Partial<Message>
  ): Promise<void> {
    // If content is being updated, compress it
    if (updates.content) {
      const tempMessage: Message = {
        id: messageId,
        role: 'user',
        content: updates.content,
        timestamp: Date.now(),
      };
      const compressed = this.compress(tempMessage);
      updates = {
        ...updates,
        content: compressed.content,
      };
    }
    await this.adapter.updateMessage(sessionId, messageId, updates);
  }

  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    await this.adapter.deleteMessage(sessionId, messageId);
  }

  async getSummary(sessionId: string): Promise<string | null> {
    const summary = await this.adapter.getSummary(sessionId);
    return summary ? this.decompressor(summary) : null;
  }

  async setSummary(sessionId: string, summary: string): Promise<void> {
    const compressed = this.compressor(summary);
    await this.adapter.setSummary(sessionId, compressed);
  }

  async clearSession(sessionId: string): Promise<void> {
    await this.adapter.clearSession(sessionId);
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return this.adapter.hasSession(sessionId);
  }
}

/**
 * Content deduplication for repeated patterns
 */
export class ContentDeduplicator {
  private patterns: Map<string, string> = new Map();
  private counter = 0;

  /**
   * Register a pattern for deduplication
   */
  register(pattern: string): string {
    const existing = this.findPattern(pattern);
    if (existing) return existing;

    const key = `__dup_${this.counter++}__`;
    this.patterns.set(key, pattern);
    return key;
  }

  /**
   * Find if pattern exists
   */
  private findPattern(pattern: string): string | undefined {
    for (const [key, value] of this.patterns) {
      if (value === pattern) return key;
    }
    return undefined;
  }

  /**
   * Expand a key to its pattern
   */
  expand(key: string): string | undefined {
    return this.patterns.get(key);
  }

  /**
   * Deduplicate content by replacing repeated long strings
   */
  deduplicate(content: string, minLength = 50): string {
    // Find repeated substrings
    const words = content.split(/\s+/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const word of words) {
      currentChunk += (currentChunk ? ' ' : '') + word;
      if (currentChunk.length >= minLength) {
        const key = this.register(currentChunk);
        chunks.push(key);
        currentChunk = '';
      }
    }

    if (currentChunk) {
      chunks.push(currentChunk);
    }

    return chunks.join(' ');
  }

  /**
   * Restore deduplicated content
   */
  restore(content: string): string {
    return content.replace(/__dup_\d+__/g, (key) => {
      return this.expand(key) ?? key;
    });
  }

  /**
   * Get number of registered patterns
   */
  size(): number {
    return this.patterns.size;
  }

  /**
   * Clear all patterns
   */
  clear(): void {
    this.patterns.clear();
    this.counter = 0;
  }
}

/**
 * Estimate memory size of messages
 */
export function estimateMemorySize(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    // Rough estimate: 2 bytes per character + object overhead
    total += msg.content.length * 2;
    total += msg.id.length * 2;
    total += msg.role.length * 2;
    total += 100; // Object overhead estimate
    if (msg.metadata) {
      total += JSON.stringify(msg.metadata).length * 2;
    }
  }
  return total;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Create a compressed adapter with a preset
 */
export function createCompressedAdapter(
  adapter: StorageAdapter,
  preset: 'minimal' | 'balanced' | 'aggressive' = 'balanced'
): CompressedStorageAdapter {
  const presets: Record<string, CompressionOptions> = {
    minimal: {
      strategy: 'none',
      threshold: Infinity,
    },
    balanced: {
      strategy: 'simple',
      threshold: 100,
    },
    aggressive: {
      strategy: 'simple',
      threshold: 50,
    },
  };

  return new CompressedStorageAdapter(adapter, presets[preset]);
}
