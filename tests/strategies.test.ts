import { describe, it, expect } from 'vitest';
import {
  SlidingWindowStrategy,
  TokenBudgetStrategy,
  ImportanceStrategy,
  CompositeStrategy,
} from '../src/strategies/index.js';
import type { Message } from '../src/types.js';

// Helper to create test messages
function createMessage(
  id: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  options: { pinned?: boolean; timestamp?: number } = {}
): Message {
  return {
    id,
    role,
    content,
    timestamp: options.timestamp ?? Date.now(),
    pinned: options.pinned,
  };
}

describe('SlidingWindowStrategy', () => {
  it('should keep only the last N messages', () => {
    const strategy = new SlidingWindowStrategy({ windowSize: 3 });
    const messages: Message[] = [
      createMessage('1', 'user', 'Message 1'),
      createMessage('2', 'assistant', 'Message 2'),
      createMessage('3', 'user', 'Message 3'),
      createMessage('4', 'assistant', 'Message 4'),
      createMessage('5', 'user', 'Message 5'),
    ];

    const result = strategy.select(messages, { maxTokens: 1000 });

    expect(result.messages.length).toBe(3);
    expect(result.messages[0].content).toBe('Message 3');
    expect(result.messages[2].content).toBe('Message 5');
    expect(result.droppedCount).toBe(2);
  });

  it('should always include pinned messages', () => {
    const strategy = new SlidingWindowStrategy({ windowSize: 2 });
    const messages: Message[] = [
      createMessage('1', 'system', 'Important system prompt', { pinned: true }),
      createMessage('2', 'user', 'Old message'),
      createMessage('3', 'assistant', 'Old reply'),
      createMessage('4', 'user', 'Recent message'),
      createMessage('5', 'assistant', 'Recent reply'),
    ];

    const result = strategy.select(messages, { maxTokens: 1000 });

    // Should have pinned + 2 recent
    expect(result.messages.some(m => m.content.includes('Important'))).toBe(true);
    expect(result.messages.some(m => m.content === 'Recent message')).toBe(true);
  });

  it('should include summary if provided', () => {
    const strategy = new SlidingWindowStrategy({ windowSize: 2 });
    const messages: Message[] = [
      createMessage('1', 'user', 'Hello'),
    ];

    const result = strategy.select(messages, {
      maxTokens: 1000,
      summary: 'Previous conversation about travel',
    });

    expect(result.messages.some(m => m.content.includes('Previous conversation'))).toBe(true);
  });
});

describe('TokenBudgetStrategy', () => {
  it('should fill up to the token budget', () => {
    const strategy = new TokenBudgetStrategy({ reserveTokens: 100 });
    const messages: Message[] = [
      createMessage('1', 'user', 'Short'),
      createMessage('2', 'assistant', 'Also short'),
      createMessage('3', 'user', 'Another short one'),
    ];

    const result = strategy.select(messages, { maxTokens: 500 });

    expect(result.tokenCount).toBeLessThanOrEqual(400); // 500 - 100 reserve
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it('should prioritize recent messages', () => {
    const strategy = new TokenBudgetStrategy({ reserveTokens: 0 });
    const messages: Message[] = [
      createMessage('1', 'user', 'A'.repeat(1000)), // Very long, old
      createMessage('2', 'user', 'Recent short message'),
    ];

    const result = strategy.select(messages, { maxTokens: 100 });

    // Should include recent short message, not old long one
    expect(result.messages.some(m => m.content === 'Recent short message')).toBe(true);
  });

  it('should always include pinned messages', () => {
    const strategy = new TokenBudgetStrategy({ reserveTokens: 0 });
    const messages: Message[] = [
      createMessage('1', 'system', 'Critical info', { pinned: true }),
      createMessage('2', 'user', 'Short message'),
    ];

    const result = strategy.select(messages, { maxTokens: 500 });

    expect(result.messages.some(m => m.content === 'Critical info')).toBe(true);
  });
});

describe('ImportanceStrategy', () => {
  it('should score and prioritize messages', () => {
    const strategy = new ImportanceStrategy();
    const messages: Message[] = [
      createMessage('1', 'user', 'Old user message'),
      createMessage('2', 'system', 'System prompt', { pinned: true }),
      createMessage('3', 'user', 'Recent user message'),
    ];

    const result = strategy.select(messages, { maxTokens: 1000 });

    // Pinned message should be included
    expect(result.messages.some(m => m.content === 'System prompt')).toBe(true);
    expect(result.droppedCount).toBe(0);
  });

  it('should respect token limits', () => {
    const strategy = new ImportanceStrategy();
    const messages: Message[] = [];
    
    for (let i = 0; i < 50; i++) {
      messages.push(createMessage(`${i}`, 'user', `Message ${i} with some content`));
    }

    const result = strategy.select(messages, { maxTokens: 200 });

    expect(result.tokenCount).toBeLessThanOrEqual(200);
    expect(result.droppedCount).toBeGreaterThan(0);
  });

  it('should maintain original order after selection', () => {
    const strategy = new ImportanceStrategy();
    const messages: Message[] = [
      createMessage('1', 'user', 'First'),
      createMessage('2', 'assistant', 'Second'),
      createMessage('3', 'user', 'Third'),
    ];

    const result = strategy.select(messages, { maxTokens: 1000 });

    // Check order is maintained
    const contents = result.messages.map(m => m.content);
    expect(contents.indexOf('First')).toBeLessThan(contents.indexOf('Second'));
    expect(contents.indexOf('Second')).toBeLessThan(contents.indexOf('Third'));
  });
});

describe('CompositeStrategy', () => {
  it('should use first successful strategy', () => {
    const sliding = new SlidingWindowStrategy({ windowSize: 5 });
    const budget = new TokenBudgetStrategy();
    const composite = new CompositeStrategy([sliding, budget]);

    const messages: Message[] = [
      createMessage('1', 'user', 'Hello'),
      createMessage('2', 'assistant', 'Hi there!'),
    ];

    const result = composite.select(messages, { maxTokens: 1000 });

    expect(result.messages.length).toBeGreaterThan(0);
    expect(result.metadata?.usedStrategy).toBe('sliding-window');
  });

  it('should fallback to next strategy if first returns empty', () => {
    // Create a strategy that always returns empty
    const emptyStrategy = {
      name: 'empty',
      select: () => ({ messages: [], tokenCount: 0, droppedCount: 0 }),
    };
    const budget = new TokenBudgetStrategy();
    const composite = new CompositeStrategy([emptyStrategy, budget]);

    const messages: Message[] = [
      createMessage('1', 'user', 'Hello'),
    ];

    const result = composite.select(messages, { maxTokens: 1000 });

    expect(result.metadata?.usedStrategy).toBe('token-budget');
  });
});
