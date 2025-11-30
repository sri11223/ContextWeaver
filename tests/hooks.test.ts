import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ContextWeaverHooks,
  createConsoleLogHook,
  createMetricsReporter,
} from '../src/hooks.js';

describe('ContextWeaverHooks', () => {
  let hooks: ContextWeaverHooks;

  beforeEach(() => {
    hooks = new ContextWeaverHooks();
  });

  describe('event handling', () => {
    it('should register and emit events', async () => {
      const handler = vi.fn();
      hooks.on('messageAdded', handler);

      await hooks.emit('messageAdded', {
        sessionId: 'test-session',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      expect(handler).toHaveBeenCalledOnce();
    });

    it('should handle multiple listeners for same event', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      
      hooks.on('messageAdded', handler1);
      hooks.on('messageAdded', handler2);

      await hooks.emit('messageAdded', {
        sessionId: 'test-session',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    it('should return unsubscribe function', async () => {
      const handler = vi.fn();
      const unsubscribe = hooks.on('messageAdded', handler);

      unsubscribe();

      await hooks.emit('messageAdded', {
        sessionId: 'test-session',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should support onAny listener', async () => {
      const anyHandler = vi.fn();
      hooks.onAny(anyHandler);

      await hooks.emit('messageAdded', {
        sessionId: 'test-session',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      await hooks.emit('messagesRetrieved', {
        sessionId: 'test-session',
        timestamp: Date.now(),
        messages: [],
        totalTokens: 0,
        maxTokens: 4000,
        strategyUsed: null,
      });

      expect(anyHandler).toHaveBeenCalledTimes(2);
    });

    it('should remove listener with off()', async () => {
      const handler = vi.fn();
      hooks.on('messageAdded', handler);
      hooks.off('messageAdded', handler);

      await hooks.emit('messageAdded', {
        sessionId: 'test-session',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('metrics', () => {
    it('should track messageAdded events', async () => {
      await hooks.emit('messageAdded', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      const metrics = hooks.getMetrics();
      expect(metrics.messagesAdded).toBe(1);
    });

    it('should track messagesRetrieved events', async () => {
      await hooks.emit('messagesRetrieved', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        messages: [
          { id: '1', role: 'user', content: 'Hi', timestamp: Date.now() },
        ],
        totalTokens: 100,
        maxTokens: 4000,
        strategyUsed: null,
      });

      const metrics = hooks.getMetrics();
      expect(metrics.messagesRetrieved).toBe(1);
      expect(metrics.tokensProcessed).toBe(100);
    });

    it('should track peak token usage', async () => {
      await hooks.emit('messagesRetrieved', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        messages: [],
        totalTokens: 500,
        maxTokens: 4000,
        strategyUsed: null,
      });

      await hooks.emit('messagesRetrieved', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        messages: [],
        totalTokens: 200,
        maxTokens: 4000,
        strategyUsed: null,
      });

      const metrics = hooks.getMetrics();
      expect(metrics.peakTokenUsage).toBe(500);
    });

    it('should track strategy applications', async () => {
      await hooks.emit('strategyApplied', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        strategyName: 'SlidingWindow',
        inputMessages: 10,
        outputMessages: 5,
        tokensUsed: 500,
        maxTokens: 1000,
      });

      const metrics = hooks.getMetrics();
      expect(metrics.strategyApplications).toBe(1);
    });

    it('should track errors', async () => {
      await hooks.emit('error', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        error: new Error('Test error'),
        operation: 'getContext',
      });

      const metrics = hooks.getMetrics();
      expect(metrics.errors).toBe(1);
    });

    it('should calculate average response time', () => {
      hooks.recordResponseTime(100);
      hooks.recordResponseTime(200);
      hooks.recordResponseTime(300);

      const metrics = hooks.getMetrics();
      expect(metrics.averageResponseTime).toBe(200);
    });

    it('should track session statistics', async () => {
      await hooks.emit('messageAdded', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      await hooks.emit('messageAdded', {
        sessionId: 'session-2',
        timestamp: Date.now(),
        message: {
          id: 'msg-2',
          role: 'user',
          content: 'World',
          timestamp: Date.now(),
        },
      });

      const metrics = hooks.getMetrics();
      expect(metrics.sessionCount).toBe(2);
    });

    it('should get session-specific metrics', async () => {
      await hooks.emit('messageAdded', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      const sessionMetrics = hooks.getSessionMetrics('session-1');
      expect(sessionMetrics).not.toBeNull();
      expect(sessionMetrics?.messageCount).toBe(1);
    });

    it('should return null for non-existent session', () => {
      const sessionMetrics = hooks.getSessionMetrics('non-existent');
      expect(sessionMetrics).toBeNull();
    });

    it('should reset metrics', async () => {
      await hooks.emit('messageAdded', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      hooks.resetMetrics();

      const metrics = hooks.getMetrics();
      expect(metrics.messagesAdded).toBe(0);
    });

    it('should remove all listeners', async () => {
      const handler = vi.fn();
      hooks.on('messageAdded', handler);
      hooks.removeAllListeners();

      await hooks.emit('messageAdded', {
        sessionId: 'session-1',
        timestamp: Date.now(),
        message: {
          id: 'msg-1',
          role: 'user',
          content: 'Hello',
          timestamp: Date.now(),
        },
      });

      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('createConsoleLogHook', () => {
  it('should create a logging hook', () => {
    const logHook = createConsoleLogHook();
    expect(typeof logHook).toBe('function');
  });

  it('should log events to console', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logHook = createConsoleLogHook();

    logHook('messageAdded', {
      sessionId: 'test-session',
      timestamp: Date.now(),
    });

    expect(consoleSpy).toHaveBeenCalledOnce();
    expect(consoleSpy.mock.calls[0][0]).toContain('[ContextWeaver] messageAdded');

    consoleSpy.mockRestore();
  });
});

describe('createMetricsReporter', () => {
  it('should create a metrics reporter', () => {
    const hooks = new ContextWeaverHooks();
    const reporter = createMetricsReporter(vi.fn(), hooks);

    expect(reporter).toHaveProperty('start');
    expect(reporter).toHaveProperty('stop');
  });

  it('should report metrics on interval', async () => {
    vi.useFakeTimers();
    
    const hooks = new ContextWeaverHooks();
    const reportFn = vi.fn();
    const reporter = createMetricsReporter(reportFn, hooks, 1000);

    reporter.start();

    await vi.advanceTimersByTimeAsync(3000);

    expect(reportFn).toHaveBeenCalledTimes(3);

    reporter.stop();
    vi.useRealTimers();
  });

  it('should stop reporting when stopped', async () => {
    vi.useFakeTimers();

    const hooks = new ContextWeaverHooks();
    const reportFn = vi.fn();
    const reporter = createMetricsReporter(reportFn, hooks, 1000);

    reporter.start();
    await vi.advanceTimersByTimeAsync(1000);
    reporter.stop();
    await vi.advanceTimersByTimeAsync(3000);

    expect(reportFn).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
