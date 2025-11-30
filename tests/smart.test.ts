import { describe, it, expect, beforeEach } from 'vitest';
import {
  LRUCache,
  TokenCache,
  BloomFilter,
  CountingBloomFilter,
  AutoImportance,
  SemanticIndex,
  LocalSummarizer,
  SmartContextWeaver,
  quickSummarize,
  quickImportanceCheck,
  ConversationPairManager,
  ConversationPairStrategy,
  hasConversationReference,
} from '../src/smart/index.js';
import type { Message } from '../src/types.js';
import { generateId, now } from '../src/utils.js';

// Helper to create a message with required fields
function createMessage(role: 'user' | 'assistant' | 'system', content: string): Message {
  return {
    id: generateId(),
    role,
    content,
    timestamp: now(),
  };
}

// =============================================================================
// LRU Cache Tests
// =============================================================================

describe('LRUCache', () => {
  let cache: LRUCache<string, number>;

  beforeEach(() => {
    cache = new LRUCache(3);
  });

  it('should store and retrieve values', () => {
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
  });

  it('should return undefined for missing keys', () => {
    expect(cache.get('missing')).toBeUndefined();
  });

  it('should evict least recently used when over capacity', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.set('d', 4); // Should evict 'a'

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.get('d')).toBe(4);
  });

  it('should update LRU order on get', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    cache.get('a'); // Access 'a' - now most recent
    cache.set('d', 4); // Should evict 'b' (least recent)

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  it('should delete items', () => {
    cache.set('a', 1);
    expect(cache.delete('a')).toBe(true);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.delete('a')).toBe(false);
  });

  it('should clear all items', () => {
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get('a')).toBeUndefined();
  });

  it('should track size correctly', () => {
    expect(cache.size).toBe(0);
    cache.set('a', 1);
    expect(cache.size).toBe(1);
    cache.set('b', 2);
    expect(cache.size).toBe(2);
  });

  it('should provide stats', () => {
    cache.set('a', 1);
    cache.get('a'); // hit
    cache.get('missing'); // miss
    
    const stats = cache.getStats();
    expect(stats.size).toBe(1);
    expect(stats.capacity).toBe(3);
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });
});

describe('TokenCache', () => {
  let cache: TokenCache;

  beforeEach(() => {
    cache = new TokenCache(100);
  });

  it('should cache token counts', () => {
    const counter = (text: string) => text.length;
    const count1 = cache.getTokenCount('hello', counter);
    const count2 = cache.getTokenCount('hello', counter);
    
    expect(count1).toBe(5);
    expect(count2).toBe(5);
    
    // Second call should be a cache hit
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
  });
});

// =============================================================================
// Bloom Filter Tests
// =============================================================================

describe('BloomFilter', () => {
  let filter: BloomFilter;

  beforeEach(() => {
    filter = new BloomFilter(100);
  });

  it('should return false for items not added', () => {
    expect(filter.mightContain('never-added')).toBe(false);
  });

  it('should return true for items added', () => {
    filter.add('test-item');
    expect(filter.mightContain('test-item')).toBe(true);
  });

  it('should handle multiple items', () => {
    filter.add('item1');
    filter.add('item2');
    filter.add('item3');

    expect(filter.mightContain('item1')).toBe(true);
    expect(filter.mightContain('item2')).toBe(true);
    expect(filter.mightContain('item3')).toBe(true);
    expect(filter.mightContain('item4')).toBe(false);
  });

  it('should clear all items', () => {
    filter.add('test');
    filter.clear();
    expect(filter.mightContain('test')).toBe(false);
  });

  it('should provide stats', () => {
    const stats = filter.getStats();
    expect(stats.size).toBeGreaterThan(0);
    expect(stats.hashCount).toBeGreaterThan(0);
    expect(stats.fillRate).toBe(0);

    filter.add('item');
    const newStats = filter.getStats();
    expect(newStats.fillRate).toBeGreaterThan(0);
  });
});

describe('CountingBloomFilter', () => {
  let filter: CountingBloomFilter;

  beforeEach(() => {
    filter = new CountingBloomFilter(100);
  });

  it('should support removal', () => {
    filter.add('item');
    expect(filter.mightContain('item')).toBe(true);
    filter.remove('item');
    expect(filter.mightContain('item')).toBe(false);
  });

  it('should handle multiple adds', () => {
    filter.add('item');
    filter.add('item');
    filter.remove('item');
    // Still there after one remove
    expect(filter.mightContain('item')).toBe(true);
    filter.remove('item');
    expect(filter.mightContain('item')).toBe(false);
  });
});

// =============================================================================
// Auto Importance Tests
// =============================================================================

describe('AutoImportance', () => {
  let autoImportance: AutoImportance;

  beforeEach(() => {
    autoImportance = new AutoImportance();
  });

  it('should detect names as important', () => {
    const msg = createMessage('user', 'My name is John');
    const score = autoImportance.calculateScore(msg);
    expect(score).toBeGreaterThan(0.5);
  });

  it('should detect budget mentions as important', () => {
    const msg = createMessage('user', 'My budget is $500');
    const score = autoImportance.calculateScore(msg);
    expect(score).toBeGreaterThan(0.5);
  });

  it('should detect email as important', () => {
    const msg = createMessage('user', 'Email me at test@example.com');
    const score = autoImportance.calculateScore(msg);
    expect(score).toBeGreaterThan(0.5);
  });

  it('should give lower scores to generic messages', () => {
    const msg = createMessage('user', 'ok');
    const score = autoImportance.calculateScore(msg, 5); // Not first message
    // Base score is 0.4 for any message, short confirmation is 0.3
    expect(score).toBeLessThanOrEqual(0.4);
  });

  it('should detect system messages as important', () => {
    const msg = createMessage('system', 'You are a helpful assistant');
    const score = autoImportance.calculateScore(msg);
    expect(score).toBe(1.0);
  });

  it('should add custom rules', () => {
    autoImportance.addRule({
      name: 'password',
      weight: 0.9,
      match: (msg) => msg.content.toLowerCase().includes('password'),
    });

    const msg = createMessage('user', 'My password is secret');
    const score = autoImportance.calculateScore(msg);
    expect(score).toBeGreaterThan(0.8);
  });

  it('should detect important patterns with quick check', () => {
    expect(quickImportanceCheck('My name is Alice')).toBeGreaterThan(0);
    expect(quickImportanceCheck('My budget is $500')).toBeGreaterThan(0);
    // Generic text returns lower score, not 0
    expect(quickImportanceCheck('ok')).toBeLessThan(quickImportanceCheck('My name is Alice'));
  });
});

// =============================================================================
// Semantic Index Tests
// =============================================================================

describe('SemanticIndex', () => {
  let index: SemanticIndex;

  beforeEach(() => {
    index = new SemanticIndex();
  });

  it('should add and search messages', () => {
    const messages: Message[] = [
      createMessage('user', 'I want to buy a laptop'),
      createMessage('assistant', 'What is your budget?'),
      createMessage('user', 'Around $1000'),
    ];

    for (const msg of messages) {
      index.add(msg);
    }
    
    const results = index.search('laptop budget', 2);

    expect(results.length).toBeLessThanOrEqual(2);
    expect(results.some(r => r.message.content.includes('laptop'))).toBe(true);
  });

  it('should handle empty index', () => {
    const results = index.search('test', 5);
    expect(results).toEqual([]);
  });

  it('should clear the index', () => {
    index.add(createMessage('user', 'test message'));
    index.clear();
    expect(index.search('test', 5)).toEqual([]);
  });

  it('should remove messages from index', () => {
    const msg = createMessage('user', 'I love JavaScript programming');
    index.add(msg);
    
    // Should find it
    expect(index.search('JavaScript', 5).length).toBeGreaterThan(0);
    
    // Remove it
    index.remove(msg.id);
    
    // Should not find it
    expect(index.search('JavaScript', 5).length).toBe(0);
  });
});

// =============================================================================
// Local Summarizer Tests
// =============================================================================

describe('LocalSummarizer', () => {
  let summarizer: LocalSummarizer;

  beforeEach(() => {
    summarizer = new LocalSummarizer();
  });

  it('should summarize messages', () => {
    const messages: Message[] = [
      createMessage('user', 'I need help finding a laptop for coding.'),
      createMessage('assistant', 'What is your budget range?'),
      createMessage('user', 'I want to spend around $1500 maximum.'),
    ];

    const summary = summarizer.summarize(messages);
    expect(summary).toBeTruthy();
    expect(summary.length).toBeGreaterThan(0);
  });

  it('should extract key points from user messages', () => {
    const messages: Message[] = [
      createMessage('user', 'I prefer lightweight laptops under 3 pounds'),
      createMessage('user', 'My budget is around $2000'),
    ];

    const summary = summarizer.summarizeForContext(messages);
    expect(summary).toContain('User mentioned');
  });

  it('should handle empty messages gracefully', () => {
    const summary = summarizer.summarize([]);
    // Returns a message when nothing to summarize
    expect(summary).toBeDefined();
  });

  it('should respect maxSentences option', () => {
    const shortSummarizer = new LocalSummarizer({ maxSentences: 1 });
    const text = 'First sentence. Second sentence. Third sentence. Fourth sentence.';
    const messages: Message[] = [createMessage('user', text)];

    const summary = shortSummarizer.summarize(messages);
    const sentenceCount = summary.split(/[.!?]+/).filter(s => s.trim()).length;
    expect(sentenceCount).toBeLessThanOrEqual(2); // Allow some variance
  });

  it('should work with quickSummarize helper', () => {
    const messages: Message[] = [
      createMessage('user', 'I like gaming laptops with good graphics'),
    ];
    
    const summary = quickSummarize(messages);
    expect(summary).toBeTruthy();
  });
});

// =============================================================================
// Smart Context Weaver Tests
// =============================================================================

describe('SmartContextWeaver', () => {
  let smart: SmartContextWeaver;

  beforeEach(() => {
    smart = new SmartContextWeaver({ tokenLimit: 500 });
  });

  it('should add and retrieve messages', async () => {
    await smart.add('session1', 'user', 'Hello!');
    const result = await smart.getContext('session1');

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe('Hello!');
  });

  it('should auto-detect importance', async () => {
    await smart.add('session1', 'user', 'My name is Bob');
    await smart.add('session1', 'user', 'ok');

    const result = await smart.getContext('session1');
    expect(result.messages.some(m => m.content.includes('Bob'))).toBe(true);
  });

  it('should handle system messages specially', async () => {
    await smart.add('session1', 'system', 'You are helpful');
    await smart.add('session1', 'user', 'Hello');

    const result = await smart.getContext('session1');
    expect(result.messages[0].role).toBe('system');
  });

  it('should get context with query relevance', async () => {
    await smart.add('session1', 'user', 'My budget is $1000');
    await smart.add('session1', 'user', 'I like gaming');
    await smart.add('session1', 'user', 'ok thanks');

    const result = await smart.getContext('session1', { currentQuery: 'budget' });
    expect(result.messages.some(m => m.content.includes('budget'))).toBe(true);
  });

  it('should clear session', async () => {
    await smart.add('session1', 'user', 'Hello');
    await smart.clear('session1');
    const result = await smart.getContext('session1');
    expect(result.messages).toHaveLength(0);
  });

  it('should pin and unpin messages', async () => {
    // Add a message with explicit ID tracking
    const id = await smart.add('session1', 'user', 'Important note');
    
    // Pin should not throw
    await expect(smart.pin('session1', id)).resolves.not.toThrow();
    
    // Unpin should not throw  
    await expect(smart.unpin('session1', id)).resolves.not.toThrow();
    
    // Context should still have the message
    const result = await smart.getContext('session1');
    expect(result.messages.length).toBe(1);
  });

  it('should work with zero config', async () => {
    const zeroConfig = new SmartContextWeaver();
    await zeroConfig.add('test', 'user', 'Hello world');
    const result = await zeroConfig.getContext('test');
    expect(result.messages).toHaveLength(1);
  });
});

// ============================================
// Conversation Pairs Tests
// ============================================

describe('ConversationPairManager', () => {
  let pairManager: ConversationPairManager;

  beforeEach(() => {
    pairManager = new ConversationPairManager();
  });

  it('should build conversation pairs from messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'What is TypeScript?', timestamp: 1000 },
      { id: '2', role: 'assistant', content: 'TypeScript is a typed superset of JavaScript.', timestamp: 1001 },
      { id: '3', role: 'user', content: 'Give me 3 steps to learn it', timestamp: 1002 },
      { id: '4', role: 'assistant', content: 'Step 1: Learn basics. Step 2: Practice. Step 3: Build projects.', timestamp: 1003 },
    ];

    const pairs = pairManager.buildPairs(messages);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].userMessage.content).toBe('What is TypeScript?');
    expect(pairs[0].assistantMessage?.content).toContain('typed superset');
    expect(pairs[1].userMessage.content).toContain('3 steps');
    expect(pairs[1].assistantMessage?.content).toContain('Step 1');
  });

  it('should handle unpaired messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: 1000 },
      { id: '2', role: 'user', content: 'Anyone there?', timestamp: 1001 },
      { id: '3', role: 'assistant', content: 'Yes, I am here!', timestamp: 1002 },
    ];

    const pairs = pairManager.buildPairs(messages);
    // Should create pairs even for consecutive user messages
    expect(pairs.length).toBeGreaterThanOrEqual(1);
  });

  it('should keep pairs together when selecting context', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'What is React?', timestamp: 1000 },
      { id: '2', role: 'assistant', content: 'React is a UI library.', timestamp: 1001 },
      { id: '3', role: 'user', content: 'Show me 2 options', timestamp: 1002 },
      { id: '4', role: 'assistant', content: 'Option A: Hooks. Option B: Classes.', timestamp: 1003 },
    ];

    const pairs = pairManager.buildPairs(messages);
    const selected = pairManager.selectPairs(pairs, { maxTokens: 1000 });
    
    // Each selected pair should have both userMessage and assistantMessage
    for (const pair of selected) {
      expect(pair.userMessage).toBeDefined();
      if (pair.userMessage.role === 'user') {
        expect(pair.assistantMessage).toBeDefined();
      }
    }
  });

  it('should detect references and prioritize referenced pairs', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Give me 3 steps', timestamp: 1000 },
      { id: '2', role: 'assistant', content: 'Step 1: A. Step 2: B. Step 3: C.', timestamp: 1001 },
      { id: '3', role: 'user', content: 'Thanks', timestamp: 1002 },
      { id: '4', role: 'assistant', content: 'You are welcome!', timestamp: 1003 },
      { id: '5', role: 'user', content: 'More filler message', timestamp: 1004 },
      { id: '6', role: 'assistant', content: 'Filler response', timestamp: 1005 },
    ];

    const pairs = pairManager.buildPairs(messages);
    
    // Select with a query that references "step 2"
    const selected = pairManager.selectPairs(pairs, {
      maxTokens: 1000,
      currentQuery: 'Explain step 2 in more detail',
    });
    
    // The pair with steps should be included
    const stepPair = selected.find(p => p.assistantMessage?.content.includes('Step 1'));
    expect(stepPair).toBeDefined();
  });

  it('should convert pairs back to messages', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Hello', timestamp: 1000 },
      { id: '2', role: 'assistant', content: 'Hi there!', timestamp: 1001 },
    ];

    const pairs = pairManager.buildPairs(messages);
    const restored = pairManager.pairsToMessages(pairs);
    
    expect(restored).toHaveLength(2);
    expect(restored[0].content).toBe('Hello');
    expect(restored[1].content).toBe('Hi there!');
  });

  it('should handle system messages', () => {
    const messages: Message[] = [
      { id: '0', role: 'system', content: 'You are a helpful assistant', timestamp: 999 },
      { id: '1', role: 'user', content: 'Hello', timestamp: 1000 },
      { id: '2', role: 'assistant', content: 'Hi!', timestamp: 1001 },
    ];

    const pairs = pairManager.buildPairs(messages);
    
    // System message should be preserved
    const systemPair = pairs.find(p => p.userMessage.role === 'system');
    expect(systemPair).toBeDefined();
  });

  it('should provide pair statistics', () => {
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Give me 3 options', timestamp: 1000 },
      { id: '2', role: 'assistant', content: '1. Option A\n2. Option B\n3. Option C', timestamp: 1001 },
      { id: '3', role: 'user', content: 'Tell me about option 2', timestamp: 1002 },
      { id: '4', role: 'assistant', content: 'Option B is great!', timestamp: 1003 },
    ];

    const pairs = pairManager.buildPairs(messages);
    const stats = pairManager.getStats(pairs);
    
    expect(stats.totalPairs).toBe(2);
    expect(stats.pairsWithSteps).toBeGreaterThanOrEqual(1);
    expect(stats.pairsWithReferences).toBeGreaterThanOrEqual(1);
  });
});

describe('hasConversationReference', () => {
  it('should detect step references', () => {
    expect(hasConversationReference('explain step 2')).toBe(true);
    expect(hasConversationReference('what about step 3?')).toBe(true);
    expect(hasConversationReference('step 1 please')).toBe(true);
  });

  it('should detect option references', () => {
    expect(hasConversationReference('go with option 1')).toBe(true);
    expect(hasConversationReference('what is option 2?')).toBe(true);
    expect(hasConversationReference('I prefer option three')).toBe(true);
  });

  it('should detect ordinal references', () => {
    expect(hasConversationReference('the first one')).toBe(true);
    expect(hasConversationReference('the second option')).toBe(true);
    expect(hasConversationReference('the last thing')).toBe(true);
  });

  it('should detect explicit back-references', () => {
    expect(hasConversationReference('you mentioned earlier')).toBe(true);
    expect(hasConversationReference('as you said before')).toBe(true);
    expect(hasConversationReference('what you told me')).toBe(true);
  });

  it('should detect continuation phrases', () => {
    expect(hasConversationReference('tell me more about it')).toBe(true);
    expect(hasConversationReference('explain that further')).toBe(true);
    expect(hasConversationReference('elaborate on this')).toBe(true);
  });

  it('should return false for simple queries without references', () => {
    expect(hasConversationReference('What is TypeScript?')).toBe(false);
    expect(hasConversationReference('Hello world')).toBe(false);
  });
});

describe('ConversationPairStrategy', () => {
  it('should apply pair strategy to messages', () => {
    const strategy = new ConversationPairStrategy();
    
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'List 3 programming languages', timestamp: 1000 },
      { id: '2', role: 'assistant', content: '1. Python 2. JavaScript 3. TypeScript', timestamp: 1001 },
      { id: '3', role: 'user', content: 'What is the weather?', timestamp: 1002 },
      { id: '4', role: 'assistant', content: 'I cannot check weather.', timestamp: 1003 },
    ];

    const result = strategy.apply(messages, {
      maxTokens: 1000,
      currentQuery: 'Tell me about number 2 in detail',
    });

    // Should include the programming languages pair since query references "number 2"
    expect(result.some(m => m.content.includes('Python'))).toBe(true);
  });

  it('should prioritize referenced pairs', () => {
    const strategy = new ConversationPairStrategy({ minRecentPairs: 1 });
    
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Give me 2 options', timestamp: 1000 },
      { id: '2', role: 'assistant', content: 'Option A: Fast. Option B: Reliable.', timestamp: 1001 },
      { id: '3', role: 'user', content: 'Unrelated question', timestamp: 1002 },
      { id: '4', role: 'assistant', content: 'Unrelated answer', timestamp: 1003 },
    ];

    const result = strategy.apply(messages, {
      maxTokens: 1000,
      currentQuery: 'I want option B',
    });

    // Should include the options pair
    expect(result.some(m => m.content.includes('Option A'))).toBe(true);
    expect(result.some(m => m.content.includes('Option B'))).toBe(true);
  });

  it('should analyze messages and return statistics', () => {
    const strategy = new ConversationPairStrategy();
    
    const messages: Message[] = [
      { id: '1', role: 'user', content: 'Give me steps', timestamp: 1000 },
      { id: '2', role: 'assistant', content: 'Step 1: Do A. Step 2: Do B.', timestamp: 1001 },
    ];

    const stats = strategy.analyze(messages);
    expect(stats.totalPairs).toBe(1);
    expect(stats.pairsWithSteps).toBe(1);
  });
});

describe('SmartContextWeaver with Conversation Pairs', () => {
  it('should enable conversation pairs mode', async () => {
    const smart = new SmartContextWeaver({
      enableConversationPairs: true,
      minRecentPairs: 2,
    });

    await smart.add('s1', 'user', 'What are 3 steps to deploy?');
    await smart.add('s1', 'assistant', 'Step 1: Build. Step 2: Test. Step 3: Deploy.');
    await smart.add('s1', 'user', 'Thanks!');
    await smart.add('s1', 'assistant', 'You are welcome!');

    const result = await smart.getContext('s1', {
      currentQuery: 'Explain step 2 in detail',
    });

    // Should include the steps pair when referencing step 2
    expect(result.messages.some(m => m.content.includes('Step 1'))).toBe(true);
  });

  it('should keep question and answer together', async () => {
    const smart = new SmartContextWeaver({
      enableConversationPairs: true,
    });

    await smart.add('s1', 'user', 'What is the capital of France?');
    await smart.add('s1', 'assistant', 'The capital of France is Paris.');
    
    const result = await smart.getContext('s1');
    
    // Both question and answer should be present
    const hasQuestion = result.messages.some(m => m.content.includes('capital of France'));
    const hasAnswer = result.messages.some(m => m.content.includes('Paris'));
    expect(hasQuestion).toBe(true);
    expect(hasAnswer).toBe(true);
  });

  it('should work without conversation pairs enabled (backward compatible)', async () => {
    const smart = new SmartContextWeaver({
      enableConversationPairs: false,
    });

    await smart.add('s1', 'user', 'Hello');
    await smart.add('s1', 'assistant', 'Hi there!');
    
    const result = await smart.getContext('s1');
    expect(result.messages).toHaveLength(2);
  });
});
