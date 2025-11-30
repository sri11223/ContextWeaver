import { describe, it, expect } from 'vitest';
import { 
  defaultTokenCounter, 
  countMessageTokens, 
  countMessagesTokens 
} from '../src/token-counter.js';

describe('Token Counter', () => {
  describe('defaultTokenCounter', () => {
    it('should return 0 for empty string', () => {
      expect(defaultTokenCounter('')).toBe(0);
    });

    it('should count tokens for simple text', () => {
      const tokens = defaultTokenCounter('Hello, world!');
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(20); // Reasonable estimate
    });

    it('should scale with text length', () => {
      const short = defaultTokenCounter('Hi');
      const long = defaultTokenCounter('This is a much longer sentence with many more words.');
      
      expect(long).toBeGreaterThan(short);
    });
  });

  describe('countMessageTokens', () => {
    it('should include overhead for message structure', () => {
      const contentOnly = defaultTokenCounter('Hello');
      const withOverhead = countMessageTokens({ role: 'user', content: 'Hello' });
      
      expect(withOverhead).toBeGreaterThan(contentOnly);
    });
  });

  describe('countMessagesTokens', () => {
    it('should count tokens for multiple messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];
      
      const total = countMessagesTokens(messages);
      
      expect(total).toBeGreaterThan(0);
    });

    it('should include array overhead', () => {
      const singleMessage = countMessageTokens({ role: 'user', content: 'Hello' });
      const arrayWithOne = countMessagesTokens([{ role: 'user', content: 'Hello' }]);
      
      // Array should have some overhead
      expect(arrayWithOne).toBeGreaterThan(singleMessage);
    });
  });
});
