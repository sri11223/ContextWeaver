/**
 * LRU Cache - High Performance In-Memory Cache
 * 
 * O(1) get, set, delete operations using Map + doubly linked list pattern
 * Used for caching token counts, embeddings, and context results
 */

interface CacheNode<K, V> {
  key: K;
  value: V;
  prev: CacheNode<K, V> | null;
  next: CacheNode<K, V> | null;
  timestamp: number;
  ttl?: number;
}

export class LRUCache<K, V> {
  private capacity: number;
  private cache: Map<K, CacheNode<K, V>>;
  private head: CacheNode<K, V> | null = null;
  private tail: CacheNode<K, V> | null = null;
  private defaultTTL?: number;

  // Stats for monitoring
  private hits = 0;
  private misses = 0;

  constructor(capacity: number = 1000, defaultTTL?: number) {
    this.capacity = capacity;
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get value from cache - O(1)
   */
  get(key: K): V | undefined {
    const node = this.cache.get(key);
    
    if (!node) {
      this.misses++;
      return undefined;
    }

    // Check TTL
    if (node.ttl && Date.now() > node.timestamp + node.ttl) {
      this.delete(key);
      this.misses++;
      return undefined;
    }

    // Move to front (most recently used)
    this.moveToFront(node);
    this.hits++;
    return node.value;
  }

  /**
   * Set value in cache - O(1)
   */
  set(key: K, value: V, ttl?: number): void {
    const existingNode = this.cache.get(key);

    if (existingNode) {
      existingNode.value = value;
      existingNode.timestamp = Date.now();
      existingNode.ttl = ttl ?? this.defaultTTL;
      this.moveToFront(existingNode);
      return;
    }

    // Evict if at capacity
    if (this.cache.size >= this.capacity) {
      this.evictLRU();
    }

    const newNode: CacheNode<K, V> = {
      key,
      value,
      prev: null,
      next: this.head,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    };

    if (this.head) {
      this.head.prev = newNode;
    }
    this.head = newNode;

    if (!this.tail) {
      this.tail = newNode;
    }

    this.cache.set(key, newNode);
  }

  /**
   * Delete from cache - O(1)
   */
  delete(key: K): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    this.removeNode(node);
    this.cache.delete(key);
    return true;
  }

  /**
   * Check if key exists - O(1)
   */
  has(key: K): boolean {
    const node = this.cache.get(key);
    if (!node) return false;

    // Check TTL
    if (node.ttl && Date.now() > node.timestamp + node.ttl) {
      this.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get or compute value - O(1) for cache hit
   */
  getOrCompute(key: K, compute: () => V, ttl?: number): V {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = compute();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Async version of getOrCompute
   */
  async getOrComputeAsync(key: K, compute: () => Promise<V>, ttl?: number): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const value = await compute();
    this.set(key, value, ttl);
    return value;
  }

  /**
   * Clear all entries
   */
  clear(): void {
    this.cache.clear();
    this.head = null;
    this.tail = null;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get current cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; capacity: number; hitRate: number; hits: number; misses: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      capacity: this.capacity,
      hitRate: total > 0 ? this.hits / total : 0,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * Get all keys (for debugging)
   */
  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  private moveToFront(node: CacheNode<K, V>): void {
    if (node === this.head) return;

    this.removeNode(node);

    node.prev = null;
    node.next = this.head;

    if (this.head) {
      this.head.prev = node;
    }
    this.head = node;

    if (!this.tail) {
      this.tail = node;
    }
  }

  private removeNode(node: CacheNode<K, V>): void {
    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.head = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.tail = node.prev;
    }
  }

  private evictLRU(): void {
    if (!this.tail) return;

    this.cache.delete(this.tail.key);
    this.removeNode(this.tail);
  }
}

/**
 * Specialized cache for token counts
 * Uses content hash as key for deduplication
 */
export class TokenCache extends LRUCache<string, number> {
  constructor(capacity: number = 5000) {
    super(capacity, 3600000); // 1 hour TTL
  }

  /**
   * Get token count with content-based caching
   */
  getTokenCount(content: string, counter: (text: string) => number): number {
    // Use simple hash for key
    const key = this.hashContent(content);
    return this.getOrCompute(key, () => counter(content));
  }

  private hashContent(content: string): string {
    // Simple DJB2 hash - fast and good distribution
    let hash = 5381;
    for (let i = 0; i < content.length; i++) {
      hash = ((hash << 5) + hash) ^ content.charCodeAt(i);
    }
    return hash.toString(36);
  }
}
