import type { TokenCounterFunction } from './types.js';

/**
 * Default token counter using a simple heuristic.
 * 
 * This provides a reasonable estimate without any dependencies.
 * For production accuracy, users should provide their own counter
 * using tiktoken or similar libraries.
 * 
 * Heuristic: ~4 characters per token for English text (OpenAI average)
 * This tends to slightly overestimate, which is safer for token limits.
 */
export const defaultTokenCounter: TokenCounterFunction = (text: string): number => {
  if (!text) return 0;
  
  // Base estimate: ~4 characters per token
  const baseEstimate = Math.ceil(text.length / 4);
  
  // Adjust for whitespace (tokens often break on spaces)
  const spaces = (text.match(/\s+/g) || []).length;
  
  // Adjust for special characters and punctuation
  const specialChars = (text.match(/[^\w\s]/g) || []).length;
  
  // Final estimate with adjustments
  return Math.ceil(baseEstimate + spaces * 0.1 + specialChars * 0.2);
};

/**
 * Count tokens for an array of messages
 */
export function countMessagesTokens(
  messages: Array<{ role: string; content: string }>,
  counter: TokenCounterFunction = defaultTokenCounter
): number {
  let total = 0;
  
  for (const message of messages) {
    // Count content tokens
    total += counter(message.content);
    // Add overhead for role and message structure (~4 tokens per message)
    total += 4;
  }
  
  // Add base overhead for the messages array (~3 tokens)
  total += 3;
  
  return total;
}

/**
 * Estimate tokens for a single message
 */
export function countMessageTokens(
  message: { role: string; content: string },
  counter: TokenCounterFunction = defaultTokenCounter
): number {
  return counter(message.content) + 4; // +4 for message structure overhead
}

/**
 * Create a token counter that uses a specific model's tokenizer
 * This is a factory for users who want to integrate tiktoken
 * 
 * @example
 * ```ts
 * import { encoding_for_model } from 'tiktoken';
 * 
 * const encoder = encoding_for_model('gpt-4');
 * const counter = createTiktokenCounter(encoder);
 * 
 * const weaver = new ContextWeaver({ tokenCounter: counter });
 * ```
 */
export function createTiktokenCounter(encoder: {
  encode: (text: string) => { length: number };
}): TokenCounterFunction {
  return (text: string): number => {
    if (!text) return 0;
    return encoder.encode(text).length;
  };
}
