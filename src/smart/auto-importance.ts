/**
 * Auto-Importance Detection
 * 
 * Automatically detects important messages using:
 * - Keyword patterns (budget, name, preference)
 * - Entity extraction (numbers, names, dates)
 * - Message structure (questions, commands)
 * - Role-based rules (system messages)
 */

import type { Message } from '../types.js';

export interface ImportanceRule {
  name: string;
  weight: number;
  match: (message: Message, index?: number) => boolean;
}

/**
 * Built-in importance patterns
 */
const IMPORTANCE_PATTERNS = {
  // Personal information
  PERSONAL: /\b(my name is|i am|i'm|call me|i live|my email|my phone|my address)\b/i,
  
  // Preferences
  PREFERENCES: /\b(i (like|prefer|want|need|love|hate)|favorite|don't like|allergic|vegetarian|vegan)\b/i,
  
  // Budget/Money
  BUDGET: /\b(budget|cost|price|afford|\$\d+|£\d+|€\d+|\d+ dollars|\d+ euros)\b/i,
  
  // Dates/Time
  DATES: /\b(january|february|march|april|may|june|july|august|september|october|november|december|\d{1,2}\/\d{1,2}|\d{4}|next week|tomorrow|yesterday)\b/i,
  
  // Important instructions
  INSTRUCTIONS: /\b(always|never|must|important|remember|don't forget|make sure|please note)\b/i,
  
  // Questions expecting context
  QUESTIONS: /\b(what did i|did i (say|mention|tell)|as i (said|mentioned)|earlier|before)\b/i,
  
  // Confirmation/Agreement
  AGREEMENT: /\b(yes|no|correct|exactly|that's right|confirmed|agreed)\b/i,
  
  // Contact info
  CONTACT: /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\+?\d{10,})\b/,
  
  // Goals/Objectives  
  GOALS: /\b(goal|objective|trying to|want to|need to|help me|looking for)\b/i,
};

/**
 * Default importance rules
 */
export const DEFAULT_RULES: ImportanceRule[] = [
  // System messages are always important
  {
    name: 'system_message',
    weight: 1.0,
    match: (m) => m.role === 'system',
  },
  
  // Personal information
  {
    name: 'personal_info',
    weight: 0.9,
    match: (m) => IMPORTANCE_PATTERNS.PERSONAL.test(m.content),
  },
  
  // Budget mentions
  {
    name: 'budget',
    weight: 0.85,
    match: (m) => IMPORTANCE_PATTERNS.BUDGET.test(m.content),
  },
  
  // Preferences
  {
    name: 'preferences',
    weight: 0.8,
    match: (m) => IMPORTANCE_PATTERNS.PREFERENCES.test(m.content),
  },
  
  // Important instructions
  {
    name: 'instructions',
    weight: 0.8,
    match: (m) => IMPORTANCE_PATTERNS.INSTRUCTIONS.test(m.content),
  },
  
  // Dates/deadlines
  {
    name: 'dates',
    weight: 0.7,
    match: (m) => IMPORTANCE_PATTERNS.DATES.test(m.content),
  },
  
  // Contact information
  {
    name: 'contact_info',
    weight: 0.9,
    match: (m) => IMPORTANCE_PATTERNS.CONTACT.test(m.content),
  },
  
  // Goals
  {
    name: 'goals',
    weight: 0.75,
    match: (m) => IMPORTANCE_PATTERNS.GOALS.test(m.content),
  },
  
  // Reference to previous context
  {
    name: 'context_reference',
    weight: 0.6,
    match: (m) => IMPORTANCE_PATTERNS.QUESTIONS.test(m.content),
  },
  
  // Short confirmations (less important)
  {
    name: 'short_response',
    weight: 0.3,
    match: (m) => m.content.length < 20 && IMPORTANCE_PATTERNS.AGREEMENT.test(m.content),
  },
  
  // Very long messages (more context)
  {
    name: 'detailed_message',
    weight: 0.7,
    match: (m) => m.content.length > 500,
  },
  
  // First user message (often sets context)
  {
    name: 'first_message',
    weight: 0.8,
    match: (m, index) => index === 0 && m.role === 'user',
  },
];

export class AutoImportance {
  private rules: ImportanceRule[];
  private customPatterns: Map<string, RegExp> = new Map();

  constructor(rules: ImportanceRule[] = DEFAULT_RULES) {
    this.rules = [...rules];
  }

  /**
   * Calculate importance score for a message
   * Returns 0-1 score
   */
  calculateScore(message: Message, index: number = 0): number {
    // If already has importance, use it
    if (message.importance !== undefined) {
      return message.importance;
    }

    // If pinned, max importance
    if (message.pinned) {
      return 1.0;
    }

    let maxScore = 0.4; // Base importance

    for (const rule of this.rules) {
      try {
        // Pass index for position-based rules
        const matches = rule.match(message, index);
        if (matches) {
          maxScore = Math.max(maxScore, rule.weight);
        }
      } catch {
        // Skip failing rules
      }
    }

    // Check custom patterns
    for (const [, pattern] of this.customPatterns) {
      if (pattern.test(message.content)) {
        maxScore = Math.max(maxScore, 0.8);
      }
    }

    return Math.min(1.0, maxScore);
  }

  /**
   * Score all messages in a conversation
   */
  scoreMessages(messages: Message[]): Array<{ message: Message; score: number }> {
    return messages.map((message, index) => ({
      message,
      score: this.calculateScore(message, index),
    }));
  }

  /**
   * Get messages above a certain importance threshold
   */
  getImportantMessages(messages: Message[], threshold: number = 0.7): Message[] {
    return this.scoreMessages(messages)
      .filter(({ score }) => score >= threshold)
      .map(({ message }) => message);
  }

  /**
   * Add a custom importance rule
   */
  addRule(rule: ImportanceRule): void {
    this.rules.push(rule);
  }

  /**
   * Add a custom pattern (simpler API)
   */
  addPattern(name: string, pattern: RegExp): void {
    this.customPatterns.set(name, pattern);
  }

  /**
   * Extract key entities from a message
   */
  extractEntities(content: string): {
    names: string[];
    numbers: string[];
    emails: string[];
    dates: string[];
  } {
    return {
      names: content.match(/\b(my name is|i'm|call me)\s+([A-Z][a-z]+)/gi)?.map(m => m.split(/\s+/).pop()!) ?? [],
      numbers: content.match(/\$[\d,]+|\d+(?:\.\d{2})?(?:\s*(?:dollars|euros|pounds))?/gi) ?? [],
      emails: content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) ?? [],
      dates: content.match(/\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}(?:,?\s+\d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/gi) ?? [],
    };
  }
}

/**
 * Quick importance check without full class
 */
export function quickImportanceCheck(content: string): number {
  let score = 0.4;

  if (IMPORTANCE_PATTERNS.PERSONAL.test(content)) score = Math.max(score, 0.9);
  if (IMPORTANCE_PATTERNS.BUDGET.test(content)) score = Math.max(score, 0.85);
  if (IMPORTANCE_PATTERNS.PREFERENCES.test(content)) score = Math.max(score, 0.8);
  if (IMPORTANCE_PATTERNS.INSTRUCTIONS.test(content)) score = Math.max(score, 0.8);
  if (IMPORTANCE_PATTERNS.CONTACT.test(content)) score = Math.max(score, 0.9);
  if (content.length < 20) score = Math.min(score, 0.5);
  if (content.length > 500) score = Math.max(score, 0.7);

  return score;
}
