/**
 * Bloom Filter - Probabilistic Data Structure
 * 
 * O(k) operations where k is number of hash functions
 * Used for fast "definitely not in set" checks
 * 
 * Use cases:
 * - Check if message was already processed
 * - Check if session exists (fast path)
 * - Deduplicate similar messages
 */

export class BloomFilter {
  private bits: Uint8Array;
  private size: number;
  private hashCount: number;

  /**
   * Create a bloom filter
   * @param expectedItems Expected number of items
   * @param falsePositiveRate Desired false positive rate (default 1%)
   */
  constructor(expectedItems: number = 10000, falsePositiveRate: number = 0.01) {
    // Calculate optimal size: m = -n * ln(p) / (ln(2)^2)
    this.size = Math.ceil(
      (-expectedItems * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2)
    );

    // Calculate optimal hash count: k = (m/n) * ln(2)
    this.hashCount = Math.ceil((this.size / expectedItems) * Math.LN2);

    // Use Uint8Array for memory efficiency
    this.bits = new Uint8Array(Math.ceil(this.size / 8));
  }

  /**
   * Add item to filter - O(k)
   */
  add(item: string): void {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      const current = this.bits[byteIndex] ?? 0;
      this.bits[byteIndex] = current | (1 << bitIndex);
    }
  }

  /**
   * Check if item might be in filter - O(k)
   * Returns false = definitely not in set
   * Returns true = probably in set (may be false positive)
   */
  mightContain(item: string): boolean {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      if (((this.bits[byteIndex] ?? 0) & (1 << bitIndex)) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get filter stats
   */
  getStats(): { size: number; hashCount: number; fillRate: number } {
    let setBits = 0;
    for (let i = 0; i < this.bits.length; i++) {
      setBits += this.popCount(this.bits[i] ?? 0);
    }
    return {
      size: this.size,
      hashCount: this.hashCount,
      fillRate: setBits / this.size,
    };
  }

  /**
   * Clear the filter
   */
  clear(): void {
    this.bits.fill(0);
  }

  /**
   * Generate k hash values using double hashing technique
   * h(i) = h1(x) + i * h2(x)
   */
  private getHashes(item: string): number[] {
    const h1 = this.hash1(item);
    const h2 = this.hash2(item);
    const hashes: number[] = [];

    for (let i = 0; i < this.hashCount; i++) {
      hashes.push(Math.abs((h1 + i * h2) | 0));
    }

    return hashes;
  }

  /**
   * FNV-1a hash
   */
  private hash1(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  /**
   * DJB2 hash
   */
  private hash2(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return hash >>> 0;
  }

  /**
   * Count set bits in a byte
   */
  private popCount(n: number): number {
    n = n - ((n >> 1) & 0x55);
    n = (n & 0x33) + ((n >> 2) & 0x33);
    return (n + (n >> 4)) & 0x0f;
  }
}

/**
 * Counting Bloom Filter - allows deletions
 */
export class CountingBloomFilter {
  private counts: Uint8Array;
  private size: number;
  private hashCount: number;

  constructor(expectedItems: number = 10000, falsePositiveRate: number = 0.01) {
    this.size = Math.ceil(
      (-expectedItems * Math.log(falsePositiveRate)) / (Math.LN2 * Math.LN2)
    );
    this.hashCount = Math.ceil((this.size / expectedItems) * Math.LN2);
    this.counts = new Uint8Array(this.size);
  }

  add(item: string): void {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      const count = this.counts[index] ?? 0;
      if (count < 255) {
        this.counts[index] = count + 1;
      }
    }
  }

  remove(item: string): void {
    if (!this.mightContain(item)) return;
    
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      const count = this.counts[index] ?? 0;
      if (count > 0) {
        this.counts[index] = count - 1;
      }
    }
  }

  mightContain(item: string): boolean {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      if ((this.counts[index] ?? 0) === 0) {
        return false;
      }
    }
    return true;
  }

  private getHashes(item: string): number[] {
    let h1 = 2166136261;
    let h2 = 5381;
    
    for (let i = 0; i < item.length; i++) {
      const c = item.charCodeAt(i);
      h1 ^= c;
      h1 = Math.imul(h1, 16777619);
      h2 = ((h2 << 5) + h2) ^ c;
    }

    const hashes: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      hashes.push(Math.abs((h1 + i * h2) | 0));
    }
    return hashes;
  }

  clear(): void {
    this.counts.fill(0);
  }
}
