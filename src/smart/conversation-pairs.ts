/**
 * Conversation Pairs - Keep Q&A Together
 * 
 * Strategies:
 * 1. Pair Detection - Link user questions with AI responses
 * 2. Reference Detection - Find "step 2", "option B", etc.
 * 3. Topic Continuity - Keep related messages together
 * 4. Smart Pruning - Drop pairs, not individual messages
 */

import type { Message } from '../types.js';

/**
 * A conversation pair: User question + AI response
 */
export interface ConversationPair {
  id: string;
  userMessage: Message;
  assistantMessage: Message | null;
  topic?: string;
  importance: number;
  hasReference: boolean;
  referencedPairIds: string[];
  timestamp: number;
}

/**
 * Reference patterns that indicate user is referring to previous content
 */
const REFERENCE_PATTERNS = {
  // Numbered references
  NUMBERED: /\b(step|option|point|item|number|#)\s*(\d+|one|two|three|four|five|six|seven|eight|nine|ten|first|second|third|fourth|fifth)\b/i,
  
  // Ordinal references
  ORDINAL: /\b(the\s+)?(first|second|third|fourth|fifth|last|previous|next)\s+(one|option|step|item|thing|point)?\b/i,
  
  // Demonstrative references
  DEMONSTRATIVE: /\b(that|this|these|those)\s+(one|thing|option|idea|suggestion|approach|method|way)\b/i,
  
  // Pronoun references
  PRONOUN: /\b(it|them|they)\b/i,
  
  // Explicit back-references
  BACK_REFERENCE: /\b(you (said|mentioned|suggested|recommended|showed|told)|earlier|before|above|previously|as you said|what you|the one you)\b/i,
  
  // Continuation phrases
  CONTINUATION: /\b(more about|tell me more|explain|elaborate|details|expand on|go on|continue|what about)\b/i,
  
  // Comparison references
  COMPARISON: /\b(the other|another|different|alternative|instead|rather than|compare|versus|vs)\b/i,
};

/**
 * Topic extraction patterns
 */
const TOPIC_PATTERNS = {
  // Question topics
  QUESTION: /(?:what|how|why|when|where|who|which|can you|could you|would you|help me|tell me about|explain)\s+(.{5,50}?)(?:\?|$)/i,
  
  // Request topics
  REQUEST: /(?:i want|i need|looking for|searching for|find me|show me|get me)\s+(.{5,50}?)(?:\.|,|$)/i,
  
  // About topics
  ABOUT: /(?:about|regarding|concerning|related to)\s+(.{5,50}?)(?:\.|,|$)/i,
};

export class ConversationPairManager {
  private pairs: Map<string, ConversationPair> = new Map();
  private messageTooPair: Map<string, string> = new Map();
  private topicIndex: Map<string, Set<string>> = new Map();
  
  /**
   * Build conversation pairs from messages
   * Links user messages with their corresponding AI responses
   */
  buildPairs(messages: Message[]): ConversationPair[] {
    this.pairs.clear();
    this.messageTooPair.clear();
    this.topicIndex.clear();
    
    const result: ConversationPair[] = [];
    let currentUserMessage: Message | null = null;
    let pairIndex = 0;
    
    for (const message of messages) {
      if (message.role === 'system') {
        // System messages are standalone, always kept
        const pair: ConversationPair = {
          id: `pair-sys-${message.id}`,
          userMessage: message,
          assistantMessage: null,
          importance: 1.0, // System always important
          hasReference: false,
          referencedPairIds: [],
          timestamp: message.timestamp,
        };
        this.pairs.set(pair.id, pair);
        this.messageTooPair.set(message.id, pair.id);
        result.push(pair);
        continue;
      }
      
      if (message.role === 'user') {
        // If we had a pending user message without response, save it
        if (currentUserMessage) {
          const pair = this.createPair(currentUserMessage, null, pairIndex++);
          this.pairs.set(pair.id, pair);
          this.messageTooPair.set(currentUserMessage.id, pair.id);
          result.push(pair);
        }
        currentUserMessage = message;
      } else if (message.role === 'assistant' && currentUserMessage) {
        // Pair user message with assistant response
        const pair = this.createPair(currentUserMessage, message, pairIndex++);
        this.pairs.set(pair.id, pair);
        this.messageTooPair.set(currentUserMessage.id, pair.id);
        this.messageTooPair.set(message.id, pair.id);
        result.push(pair);
        currentUserMessage = null;
      } else if (message.role === 'assistant') {
        // Standalone assistant message (rare)
        const pair: ConversationPair = {
          id: `pair-${pairIndex++}`,
          userMessage: message, // Put in userMessage slot
          assistantMessage: null,
          importance: 0.5,
          hasReference: false,
          referencedPairIds: [],
          timestamp: message.timestamp,
        };
        this.pairs.set(pair.id, pair);
        this.messageTooPair.set(message.id, pair.id);
        result.push(pair);
      }
    }
    
    // Handle trailing user message
    if (currentUserMessage) {
      const pair = this.createPair(currentUserMessage, null, pairIndex);
      this.pairs.set(pair.id, pair);
      this.messageTooPair.set(currentUserMessage.id, pair.id);
      result.push(pair);
    }
    
    // Resolve references between pairs
    this.resolveReferences(result);
    
    return result;
  }
  
  /**
   * Create a conversation pair
   */
  private createPair(
    userMessage: Message,
    assistantMessage: Message | null,
    index: number
  ): ConversationPair {
    const hasReference = this.detectReference(userMessage.content);
    const topic = this.extractTopic(userMessage.content);
    
    // Calculate importance
    let importance = userMessage.importance ?? 0.5;
    
    // Boost if has references (user is referring back)
    if (hasReference) {
      importance = Math.max(importance, 0.7);
    }
    
    // Boost if assistant gave detailed response
    if (assistantMessage && assistantMessage.content.length > 200) {
      importance = Math.min(importance + 0.1, 1.0);
    }
    
    // Boost if contains lists/steps (likely to be referenced)
    if (assistantMessage && this.containsListOrSteps(assistantMessage.content)) {
      importance = Math.min(importance + 0.15, 1.0);
    }
    
    const pair: ConversationPair = {
      id: `pair-${index}`,
      userMessage,
      assistantMessage,
      topic,
      importance,
      hasReference,
      referencedPairIds: [],
      timestamp: userMessage.timestamp,
    };
    
    // Index by topic
    if (topic) {
      const topicKey = topic.toLowerCase();
      if (!this.topicIndex.has(topicKey)) {
        this.topicIndex.set(topicKey, new Set());
      }
      this.topicIndex.get(topicKey)!.add(pair.id);
    }
    
    return pair;
  }
  
  /**
   * Detect if message contains references to previous content
   */
  detectReference(content: string): boolean {
    for (const pattern of Object.values(REFERENCE_PATTERNS)) {
      if (pattern.test(content)) {
        return true;
      }
    }
    return false;
  }
  
  /**
   * Extract what type of reference (step 2, option B, etc.)
   */
  extractReferenceType(content: string): { type: string; value: string } | null {
    // Check for numbered references
    const numberedMatch = content.match(REFERENCE_PATTERNS.NUMBERED);
    if (numberedMatch && numberedMatch[2]) {
      return { type: 'numbered', value: numberedMatch[2] };
    }
    
    // Check for ordinal references
    const ordinalMatch = content.match(REFERENCE_PATTERNS.ORDINAL);
    if (ordinalMatch && ordinalMatch[2]) {
      return { type: 'ordinal', value: ordinalMatch[2] };
    }
    
    return null;
  }
  
  /**
   * Extract topic from message
   */
  private extractTopic(content: string): string | undefined {
    for (const pattern of Object.values(TOPIC_PATTERNS)) {
      const match = content.match(pattern);
      if (match?.[1]) {
        return match[1].trim();
      }
    }
    return undefined;
  }
  
  /**
   * Check if content contains lists or steps
   */
  private containsListOrSteps(content: string): boolean {
    // Check for numbered lists
    if (/^\s*\d+[\.\)]\s/m.test(content)) return true;
    
    // Check for bullet points
    if (/^\s*[-•*]\s/m.test(content)) return true;
    
    // Check for step/option mentions
    if (/\b(step|option|choice)\s+\d/i.test(content)) return true;
    
    // Check for lettered options
    if (/\b[A-D][\.\)]\s/m.test(content)) return true;

    return false;
  }
  
  /**
   * Resolve references between pairs
   * If pair B references "step 2", find the pair with steps
   */
  private resolveReferences(pairs: ConversationPair[]): void {
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (!pair || !pair.hasReference) continue;
      
      // Look backwards for referenced content
      for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
        const prevPair = pairs[j];
        if (!prevPair) continue;
        
        // If previous pair has steps/lists and current references them
        if (prevPair.assistantMessage && 
            this.containsListOrSteps(prevPair.assistantMessage.content)) {
          pair.referencedPairIds.push(prevPair.id);
          // Boost importance of referenced pair
          prevPair.importance = Math.min(prevPair.importance + 0.2, 1.0);
          break;
        }
        
        // Topic match
        if (pair.topic && prevPair.topic && 
            pair.topic.toLowerCase().includes(prevPair.topic.toLowerCase())) {
          pair.referencedPairIds.push(prevPair.id);
        }
      }
    }
  }  /**
   * Get pairs that should be kept based on current query
   * Uses smart selection algorithm
   */
  selectPairs(
    pairs: ConversationPair[],
    options: {
      maxPairs?: number;
      maxTokens?: number;
      currentQuery?: string;
      tokenCounter?: (text: string) => number;
      minRecentPairs?: number;
    } = {}
  ): ConversationPair[] {
    const {
      maxPairs = 20,
      maxTokens = 4000,
      currentQuery,
      tokenCounter = (t) => Math.ceil(t.length / 4),
      minRecentPairs = 3,
    } = options;
    
    if (pairs.length === 0) return [];
    
    // Step 1: Always keep system pairs
    const systemPairs = pairs.filter(p => p.userMessage.role === 'system');
    
    // Step 2: Always keep recent pairs (last N)
    const nonSystemPairs = pairs.filter(p => p.userMessage.role !== 'system');
    const recentPairs = nonSystemPairs.slice(-minRecentPairs);
    const olderPairs = nonSystemPairs.slice(0, -minRecentPairs);
    
    // Step 3: Check if current query has references
    let referencedPairs: ConversationPair[] = [];
    if (currentQuery && this.detectReference(currentQuery)) {
      // Find pairs that might be referenced
      referencedPairs = olderPairs.filter(p => 
        p.assistantMessage && this.containsListOrSteps(p.assistantMessage.content)
      );
    }
    
    // Step 4: Score older pairs by importance
    const scoredOlder = olderPairs
      .filter(p => !referencedPairs.includes(p))
      .sort((a, b) => b.importance - a.importance);
    
    // Step 5: Build final selection within token budget
    const selected: ConversationPair[] = [...systemPairs];
    let currentTokens = this.countPairTokens(selected, tokenCounter);
    
    // Add referenced pairs first
    for (const pair of referencedPairs) {
      const pairTokens = this.countPairTokens([pair], tokenCounter);
      if (currentTokens + pairTokens <= maxTokens && selected.length < maxPairs) {
        selected.push(pair);
        currentTokens += pairTokens;
      }
    }
    
    // Add important older pairs
    for (const pair of scoredOlder) {
      const pairTokens = this.countPairTokens([pair], tokenCounter);
      if (currentTokens + pairTokens <= maxTokens * 0.6 && selected.length < maxPairs - minRecentPairs) {
        selected.push(pair);
        currentTokens += pairTokens;
      }
    }
    
    // Add recent pairs (always keep these)
    for (const pair of recentPairs) {
      const pairTokens = this.countPairTokens([pair], tokenCounter);
      if (currentTokens + pairTokens <= maxTokens) {
        selected.push(pair);
        currentTokens += pairTokens;
      }
    }
    
    // Sort by timestamp for correct order
    selected.sort((a, b) => a.timestamp - b.timestamp);
    
    return selected;
  }
  
  /**
   * Count tokens for pairs
   */
  private countPairTokens(
    pairs: ConversationPair[],
    tokenCounter: (text: string) => number
  ): number {
    let total = 0;
    for (const pair of pairs) {
      total += tokenCounter(pair.userMessage.content);
      if (pair.assistantMessage) {
        total += tokenCounter(pair.assistantMessage.content);
      }
    }
    return total;
  }
  
  /**
   * Convert pairs back to messages array
   */
  pairsToMessages(pairs: ConversationPair[]): Message[] {
    const messages: Message[] = [];
    
    for (const pair of pairs) {
      messages.push(pair.userMessage);
      if (pair.assistantMessage) {
        messages.push(pair.assistantMessage);
      }
    }
    
    return messages;
  }
  
  /**
   * Get statistics about pairs
   */
  getStats(pairs: ConversationPair[]): {
    totalPairs: number;
    pairsWithReferences: number;
    pairsWithSteps: number;
    avgImportance: number;
    topicsCovered: number;
  } {
    const pairsWithRefs = pairs.filter(p => p.hasReference).length;
    const pairsWithSteps = pairs.filter(p => 
      p.assistantMessage && this.containsListOrSteps(p.assistantMessage.content)
    ).length;
    const avgImportance = pairs.reduce((sum, p) => sum + p.importance, 0) / pairs.length;
    const topics = new Set(pairs.map(p => p.topic).filter(Boolean));
    
    return {
      totalPairs: pairs.length,
      pairsWithReferences: pairsWithRefs,
      pairsWithSteps,
      avgImportance,
      topicsCovered: topics.size,
    };
  }
}

/**
 * Quick helper to check if text contains references
 */
export function hasConversationReference(text: string): boolean {
  const manager = new ConversationPairManager();
  return manager.detectReference(text);
}

/**
 * Conversation Pair Strategy for ContextWeaver
 */
export class ConversationPairStrategy {
  private manager: ConversationPairManager;
  private minRecentPairs: number;
  
  constructor(options: { minRecentPairs?: number } = {}) {
    this.manager = new ConversationPairManager();
    this.minRecentPairs = options.minRecentPairs ?? 3;
  }
  
  /**
   * Apply conversation pair strategy to messages
   */
  apply(
    messages: Message[],
    options: {
      maxTokens: number;
      currentQuery?: string;
      tokenCounter?: (text: string) => number;
    }
  ): Message[] {
    // Build pairs
    const pairs = this.manager.buildPairs(messages);
    
    // Select best pairs
    const selected = this.manager.selectPairs(pairs, {
      maxTokens: options.maxTokens,
      currentQuery: options.currentQuery,
      tokenCounter: options.tokenCounter,
      minRecentPairs: this.minRecentPairs,
    });
    
    // Convert back to messages
    return this.manager.pairsToMessages(selected);
  }
  
  /**
   * Get pair statistics
   */
  analyze(messages: Message[]): ReturnType<ConversationPairManager['getStats']> {
    const pairs = this.manager.buildPairs(messages);
    return this.manager.getStats(pairs);
  }
}
