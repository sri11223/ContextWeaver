/**
 * Semantic Index - TF-IDF based lightweight semantic search
 * 
 * No external dependencies, no embeddings API calls
 * Uses TF-IDF for semantic similarity matching
 * 
 * O(n) indexing, O(n*m) search where n=docs, m=query terms
 */

import type { Message } from '../types.js';

interface DocumentVector {
  id: string;
  terms: Map<string, number>; // term -> TF-IDF score
  magnitude: number;
}

interface IndexedMessage {
  message: Message;
  vector: DocumentVector;
}

// Common stop words to filter out
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need',
  'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he',
  'she', 'we', 'they', 'what', 'which', 'who', 'when', 'where', 'why',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'most', 'other',
  'some', 'such', 'no', 'not', 'only', 'own', 'same', 'so', 'than',
  'too', 'very', 'just', 'also', 'now', 'here', 'there', 'then',
]);

export class SemanticIndex {
  private documents: Map<string, IndexedMessage> = new Map();
  private documentFrequency: Map<string, number> = new Map(); // term -> doc count
  private totalDocuments = 0;
  private dirty = false; // IDF needs recalculation

  /**
   * Add a message to the index
   */
  add(message: Message): void {
    const terms = this.tokenize(message.content);
    const termFrequency = this.calculateTF(terms);

    // Update document frequency
    for (const term of termFrequency.keys()) {
      this.documentFrequency.set(
        term,
        (this.documentFrequency.get(term) ?? 0) + 1
      );
    }

    const vector: DocumentVector = {
      id: message.id,
      terms: termFrequency,
      magnitude: 0, // Will be calculated when IDF is updated
    };

    this.documents.set(message.id, { message, vector });
    this.totalDocuments++;
    this.dirty = true;
  }

  /**
   * Remove a message from the index
   */
  remove(messageId: string): boolean {
    const indexed = this.documents.get(messageId);
    if (!indexed) return false;

    // Update document frequency
    for (const term of indexed.vector.terms.keys()) {
      const count = this.documentFrequency.get(term) ?? 0;
      if (count <= 1) {
        this.documentFrequency.delete(term);
      } else {
        this.documentFrequency.set(term, count - 1);
      }
    }

    this.documents.delete(messageId);
    this.totalDocuments--;
    this.dirty = true;
    return true;
  }

  /**
   * Find semantically similar messages to a query
   */
  search(query: string, topK: number = 5, minScore: number = 0.1): Array<{ message: Message; score: number }> {
    if (this.dirty) {
      this.recalculateIDF();
    }

    const queryTerms = this.tokenize(query);
    const queryTF = this.calculateTF(queryTerms);
    const queryVector = this.calculateTFIDF(queryTF);
    const queryMagnitude = this.calculateMagnitude(queryVector);

    if (queryMagnitude === 0) return [];

    const results: Array<{ message: Message; score: number }> = [];

    for (const [, indexed] of this.documents) {
      const score = this.cosineSimilarity(
        queryVector,
        queryMagnitude,
        indexed.vector.terms,
        indexed.vector.magnitude
      );

      if (score >= minScore) {
        results.push({ message: indexed.message, score });
      }
    }

    // Sort by score descending and take top K
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK);
  }

  /**
   * Find messages relevant to the current query (for context retrieval)
   */
  findRelevant(
    currentQuery: string,
    messages: Message[],
    topK: number = 10
  ): Message[] {
    // Index all messages temporarily
    const tempIndex = new SemanticIndex();
    for (const message of messages) {
      tempIndex.add(message);
    }

    // Search for relevant
    const results = tempIndex.search(currentQuery, topK, 0.05);
    return results.map(r => r.message);
  }

  /**
   * Get index statistics
   */
  getStats(): { documents: number; uniqueTerms: number } {
    return {
      documents: this.totalDocuments,
      uniqueTerms: this.documentFrequency.size,
    };
  }

  /**
   * Clear the index
   */
  clear(): void {
    this.documents.clear();
    this.documentFrequency.clear();
    this.totalDocuments = 0;
    this.dirty = false;
  }

  // ============ Private Methods ============

  /**
   * Tokenize text into terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ') // Remove punctuation
      .split(/\s+/)
      .filter(term => term.length > 2 && !STOP_WORDS.has(term));
  }

  /**
   * Calculate term frequency (TF)
   */
  private calculateTF(terms: string[]): Map<string, number> {
    const tf = new Map<string, number>();
    const maxFreq = Math.max(1, ...this.countTerms(terms).values());

    for (const [term, count] of this.countTerms(terms)) {
      // Normalized TF: count / maxCount
      tf.set(term, count / maxFreq);
    }

    return tf;
  }

  /**
   * Count term occurrences
   */
  private countTerms(terms: string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const term of terms) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    return counts;
  }

  /**
   * Calculate TF-IDF vector
   */
  private calculateTFIDF(tf: Map<string, number>): Map<string, number> {
    const tfidf = new Map<string, number>();

    for (const [term, tfScore] of tf) {
      const df = this.documentFrequency.get(term) ?? 0;
      // IDF = log(N / (df + 1)) + 1 (smoothed)
      const idf = Math.log(this.totalDocuments / (df + 1)) + 1;
      tfidf.set(term, tfScore * idf);
    }

    return tfidf;
  }

  /**
   * Calculate vector magnitude
   */
  private calculateMagnitude(vector: Map<string, number>): number {
    let sum = 0;
    for (const value of vector.values()) {
      sum += value * value;
    }
    return Math.sqrt(sum);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(
    v1: Map<string, number>,
    mag1: number,
    v2: Map<string, number>,
    mag2: number
  ): number {
    if (mag1 === 0 || mag2 === 0) return 0;

    let dotProduct = 0;
    for (const [term, score] of v1) {
      const otherScore = v2.get(term);
      if (otherScore !== undefined) {
        dotProduct += score * otherScore;
      }
    }

    return dotProduct / (mag1 * mag2);
  }

  /**
   * Recalculate IDF and update all document vectors
   */
  private recalculateIDF(): void {
    for (const [, indexed] of this.documents) {
      const tfidf = this.calculateTFIDF(indexed.vector.terms);
      indexed.vector.terms = tfidf;
      indexed.vector.magnitude = this.calculateMagnitude(tfidf);
    }
    this.dirty = false;
  }
}

/**
 * Quick relevance score without full indexing
 * Uses Jaccard similarity + keyword overlap
 */
export function quickRelevanceScore(query: string, content: string): number {
  const queryWords = new Set(
    query.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2)
  );
  const contentWords = new Set(
    content.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2)
  );

  // Jaccard similarity
  const intersection = new Set([...queryWords].filter(w => contentWords.has(w)));
  const union = new Set([...queryWords, ...contentWords]);

  if (union.size === 0) return 0;

  return intersection.size / union.size;
}
