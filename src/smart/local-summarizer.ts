/**
 * Local Summarizer - No API calls needed
 * 
 * Uses extractive summarization techniques:
 * - TextRank algorithm (PageRank for sentences)
 * - Key phrase extraction
 * - Entity preservation
 * 
 * Perfect for summarizing when you don't want to pay for API calls
 */

import type { Message } from '../types.js';

export class LocalSummarizer {
  private maxSentences: number;
  private minSentenceLength: number;

  constructor(options: { maxSentences?: number; minSentenceLength?: number } = {}) {
    this.maxSentences = options.maxSentences ?? 3;
    this.minSentenceLength = options.minSentenceLength ?? 20;
  }

  /**
   * Summarize a conversation
   */
  summarize(messages: Message[]): string {
    // Combine all messages into text
    const fullText = messages
      .map(m => `${m.role}: ${m.content}`)
      .join('\n');

    // Extract key information
    const entities = this.extractKeyEntities(fullText);
    const topSentences = this.extractTopSentences(fullText);

    // Build summary
    const parts: string[] = [];

    // Add entity summary if we found important info
    if (entities.length > 0) {
      parts.push(`Key info: ${entities.join(', ')}`);
    }

    // Add top sentences
    if (topSentences.length > 0) {
      parts.push(topSentences.join(' '));
    }

    return parts.join('. ') || 'No significant content to summarize.';
  }

  /**
   * Summarize for context preservation
   * Focuses on preserving actionable information
   */
  summarizeForContext(messages: Message[]): string {
    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    const userSummary = this.extractKeyPoints(userMessages);
    const assistantSummary = this.extractKeyActions(assistantMessages);

    const parts: string[] = [];

    if (userSummary) {
      parts.push(`User mentioned: ${userSummary}`);
    }

    if (assistantSummary) {
      parts.push(`Assistant provided: ${assistantSummary}`);
    }

    return parts.join(' ') || 'Previous conversation context.';
  }

  /**
   * Extract top sentences using TextRank-like scoring
   */
  private extractTopSentences(text: string): string[] {
    const sentences = this.splitSentences(text);
    
    if (sentences.length === 0) return [];
    if (sentences.length <= this.maxSentences) return sentences;

    // Score sentences
    const scored = sentences.map((sentence, index) => ({
      text: sentence,
      score: this.scoreSentence(sentence, sentences),
      index,
    }));

    // Sort by score and take top
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, this.maxSentences);

    // Sort back by original order for coherence
    top.sort((a, b) => a.index - b.index);

    return top.map(s => s.text);
  }

  /**
   * Score a sentence based on:
   * - Length (longer = more content)
   * - Keyword presence
   * - Similarity to other sentences (centrality)
   */
  private scoreSentence(sentence: string, allSentences: string[]): number {
    let score = 0;

    // Length score (normalized)
    const lengthScore = Math.min(sentence.length / 200, 1) * 0.3;
    score += lengthScore;

    // Keyword presence
    const importantKeywords = [
      'budget', 'cost', 'price', 'name', 'email', 'phone',
      'prefer', 'want', 'need', 'important', 'must', 'always',
      'date', 'time', 'deadline', 'goal', 'objective',
    ];

    const sentenceLower = sentence.toLowerCase();
    const keywordScore = importantKeywords.filter(k => sentenceLower.includes(k)).length * 0.1;
    score += Math.min(keywordScore, 0.4);

    // Contains numbers (often important)
    if (/\d+/.test(sentence)) {
      score += 0.15;
    }

    // Contains proper nouns (capitalized words)
    const properNouns = sentence.match(/\b[A-Z][a-z]+\b/g);
    if (properNouns && properNouns.length > 0) {
      score += Math.min(properNouns.length * 0.05, 0.15);
    }

    // Centrality: similarity to other sentences
    let similaritySum = 0;
    for (const other of allSentences) {
      if (other !== sentence) {
        similaritySum += this.jaccardSimilarity(sentence, other);
      }
    }
    const centralityScore = (similaritySum / (allSentences.length - 1)) * 0.2;
    score += centralityScore;

    return score;
  }

  /**
   * Extract key entities (names, numbers, dates, etc.)
   */
  private extractKeyEntities(text: string): string[] {
    const entities: string[] = [];

    // Names
    const nameMatch = text.match(/(?:my name is|i'm|i am|call me)\s+([A-Z][a-z]+)/gi);
    if (nameMatch) {
      entities.push(...nameMatch.map(m => m.split(/\s+/).pop()!));
    }

    // Budget/money
    const moneyMatch = text.match(/\$[\d,]+(?:\.\d{2})?|\d+\s*(?:dollars|euros|pounds)/gi);
    if (moneyMatch) {
      entities.push(...moneyMatch.slice(0, 2)); // Max 2
    }

    // Email
    const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g);
    if (emailMatch) {
      entities.push(emailMatch[0]);
    }

    // Dates
    const dateMatch = text.match(/(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?/gi);
    if (dateMatch) {
      entities.push(dateMatch[0]);
    }

    return [...new Set(entities)]; // Deduplicate
  }

  /**
   * Extract key points from user messages
   */
  private extractKeyPoints(messages: Message[]): string {
    const points: string[] = [];

    for (const msg of messages) {
      const content = msg.content.toLowerCase();

      // Preferences
      if (/i (like|prefer|want|need|love)/.test(content)) {
        const match = msg.content.match(/i (?:like|prefer|want|need|love)\s+(.{10,50}?)(?:\.|,|$)/i);
        if (match?.[1]) points.push(match[1].trim());
      }

      // Constraints
      if (/budget|max|limit|under|less than/.test(content)) {
        const match = msg.content.match(/(?:budget|max|limit)[^.]{0,30}?\$?[\d,]+/i);
        if (match?.[0]) points.push(match[0].trim());
      }

      // Goals
      if (/trying to|want to|looking for|need to/.test(content)) {
        const match = msg.content.match(/(?:trying to|want to|looking for|need to)\s+(.{10,40}?)(?:\.|,|$)/i);
        if (match?.[1]) points.push(match[1].trim());
      }
    }

    return points.slice(0, 3).join('; ');
  }

  /**
   * Extract key actions from assistant messages
   */
  private extractKeyActions(messages: Message[]): string {
    const actions: string[] = [];

    for (const msg of messages) {
      const content = msg.content.toLowerCase();

      // Suggestions made
      if (/suggest|recommend|here are|option|choice/.test(content)) {
        actions.push('suggestions');
      }

      // Questions asked
      if (/\?/.test(msg.content)) {
        actions.push('questions');
      }

      // Information provided
      if (/here's|here is|the .* is|found|result/.test(content)) {
        actions.push('information');
      }
    }

    const unique = [...new Set(actions)];
    return unique.length > 0 ? unique.join(', ') : '';
  }

  /**
   * Split text into sentences
   */
  private splitSentences(text: string): string[] {
    return text
      .split(/[.!?]+/)
      .map(s => s.trim())
      .filter(s => s.length >= this.minSentenceLength);
  }

  /**
   * Jaccard similarity between two sentences
   */
  private jaccardSimilarity(s1: string, s2: string): number {
    const words1 = new Set(s1.toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const words2 = new Set(s2.toLowerCase().split(/\s+/).filter(w => w.length > 2));

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }
}

/**
 * Quick summary function
 */
export function quickSummarize(messages: Message[]): string {
  const summarizer = new LocalSummarizer();
  return summarizer.summarizeForContext(messages);
}
