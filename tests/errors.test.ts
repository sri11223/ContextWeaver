import { describe, it, expect } from 'vitest';
import {
  ContextWeaverError,
  TokenLimitExceededError,
  SessionNotFoundError,
  MessageNotFoundError,
  StorageError,
  isContextWeaverError,
  wrapError,
} from '../src/errors.js';

describe('Error Classes', () => {
  describe('ContextWeaverError', () => {
    it('should create error with code and context', () => {
      const error = new ContextWeaverError('Test error', 'TEST_CODE', { foo: 'bar' });

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.context).toEqual({ foo: 'bar' });
      expect(error.name).toBe('ContextWeaverError');
    });

    it('should serialize to JSON', () => {
      const error = new ContextWeaverError('Test', 'CODE', { key: 'value' });
      const json = error.toJSON();

      expect(json.name).toBe('ContextWeaverError');
      expect(json.code).toBe('CODE');
      expect(json.message).toBe('Test');
      expect(json.context).toEqual({ key: 'value' });
    });
  });

  describe('TokenLimitExceededError', () => {
    it('should include requested and limit values', () => {
      const error = new TokenLimitExceededError(5000, 4000);

      expect(error.message).toContain('5000');
      expect(error.message).toContain('4000');
      expect(error.code).toBe('TOKEN_LIMIT_EXCEEDED');
      expect(error.context?.requested).toBe(5000);
      expect(error.context?.limit).toBe(4000);
    });
  });

  describe('SessionNotFoundError', () => {
    it('should include session ID', () => {
      const error = new SessionNotFoundError('session-123');

      expect(error.message).toContain('session-123');
      expect(error.code).toBe('SESSION_NOT_FOUND');
      expect(error.context?.sessionId).toBe('session-123');
    });
  });

  describe('MessageNotFoundError', () => {
    it('should include session and message IDs', () => {
      const error = new MessageNotFoundError('session-1', 'msg-1');

      expect(error.message).toContain('session-1');
      expect(error.message).toContain('msg-1');
      expect(error.code).toBe('MESSAGE_NOT_FOUND');
    });
  });

  describe('StorageError', () => {
    it('should wrap original error', () => {
      const original = new Error('Connection failed');
      const error = new StorageError('save message', original);

      expect(error.message).toContain('save message');
      expect(error.message).toContain('Connection failed');
      expect(error.originalError).toBe(original);
    });
  });

  describe('isContextWeaverError', () => {
    it('should return true for ContextWeaver errors', () => {
      expect(isContextWeaverError(new ContextWeaverError('test', 'CODE'))).toBe(true);
      expect(isContextWeaverError(new TokenLimitExceededError(100, 50))).toBe(true);
      expect(isContextWeaverError(new SessionNotFoundError('id'))).toBe(true);
    });

    it('should return false for other errors', () => {
      expect(isContextWeaverError(new Error('test'))).toBe(false);
      expect(isContextWeaverError('string')).toBe(false);
      expect(isContextWeaverError(null)).toBe(false);
    });
  });

  describe('wrapError', () => {
    it('should return ContextWeaver errors as-is', () => {
      const original = new TokenLimitExceededError(100, 50);
      const wrapped = wrapError(original, 'operation');

      expect(wrapped).toBe(original);
    });

    it('should wrap regular errors', () => {
      const original = new Error('Something failed');
      const wrapped = wrapError(original, 'save');

      expect(wrapped).toBeInstanceOf(StorageError);
      expect(wrapped.message).toContain('save');
    });

    it('should handle non-error values', () => {
      const wrapped = wrapError('string error', 'operation');

      expect(wrapped).toBeInstanceOf(ContextWeaverError);
      expect(wrapped.code).toBe('UNKNOWN_ERROR');
    });
  });
});
