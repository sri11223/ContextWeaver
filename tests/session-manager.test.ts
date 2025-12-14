import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SessionManager,
  createSessionManager,
  createSessionMiddleware,
} from '../src/session-manager.js';
import { ContextWeaver } from '../src/context-weaver.js';

describe('SessionManager', () => {
  let memory: ContextWeaver;
  let sessions: SessionManager;

  beforeEach(() => {
    memory = new ContextWeaver({ tokenLimit: 4000 });
    sessions = new SessionManager(memory, {
      defaultTTL: 1000, // 1 second for testing
      autoCleanup: false,
    });
  });

  afterEach(() => {
    sessions.destroy();
  });

  describe('create', () => {
    it('should create session with metadata', async () => {
      const metadata = await sessions.create('session-1');

      expect(metadata.createdAt).toBeDefined();
      expect(metadata.lastActivityAt).toBeDefined();
      expect(metadata.status).toBe('active');
    });

    it('should create session with custom TTL', async () => {
      const metadata = await sessions.create('session-1', {
        ttl: 5000,
      });

      expect(metadata.expiresAt).toBeDefined();
      expect(metadata.expiresAt! - metadata.createdAt).toBe(5000);
    });

    it('should create session with userData', async () => {
      const metadata = await sessions.create('session-1', {
        userData: { userId: 'user-123', name: 'John' },
      });

      expect(metadata.userData).toEqual({ userId: 'user-123', name: 'John' });
    });

    it('should create session with tags', async () => {
      const metadata = await sessions.create('session-1', {
        tags: ['support', 'billing'],
      });

      expect(metadata.tags).toEqual(['support', 'billing']);
    });
  });

  describe('touch', () => {
    it('should update last activity time', async () => {
      await sessions.create('session-1');
      
      // Wait a bit
      await new Promise(r => setTimeout(r, 10));
      
      const before = (await sessions.get('session-1'))!.lastActivityAt;
      await sessions.touch('session-1');
      const after = (await sessions.get('session-1'))!.lastActivityAt;

      expect(after).toBeGreaterThanOrEqual(before);
    });

    it('should reset TTL', async () => {
      await sessions.create('session-1', { ttl: 100 });
      
      await new Promise(r => setTimeout(r, 50));
      
      await sessions.touch('session-1', { ttl: 1000 });
      
      const ttl = sessions.getTimeToLive('session-1');
      expect(ttl).toBeGreaterThan(500);
    });

    it('should return null for non-existent session', async () => {
      const result = await sessions.touch('non-existent');
      expect(result).toBeNull();
    });
  });

  describe('get', () => {
    it('should get session metadata', async () => {
      await sessions.create('session-1', {
        userData: { test: true },
      });

      const metadata = await sessions.get('session-1');

      expect(metadata).not.toBeNull();
      expect(metadata!.userData).toEqual({ test: true });
    });

    it('should return null for non-existent session', async () => {
      const metadata = await sessions.get('non-existent');
      expect(metadata).toBeNull();
    });
  });

  describe('update', () => {
    it('should update userData', async () => {
      await sessions.create('session-1', {
        userData: { a: 1 },
      });

      await sessions.update('session-1', {
        userData: { b: 2 },
      });

      const metadata = await sessions.get('session-1');
      expect(metadata!.userData).toEqual({ a: 1, b: 2 });
    });

    it('should update tags', async () => {
      await sessions.create('session-1');

      await sessions.update('session-1', {
        tags: ['new-tag'],
      });

      const metadata = await sessions.get('session-1');
      expect(metadata!.tags).toEqual(['new-tag']);
    });

    it('should update TTL', async () => {
      await sessions.create('session-1', { ttl: 1000 });

      await sessions.update('session-1', { ttl: 5000 });

      const ttl = sessions.getTimeToLive('session-1');
      expect(ttl).toBeGreaterThan(4000);
    });
  });

  describe('isExpired', () => {
    it('should detect expired session', async () => {
      await sessions.create('session-1', { ttl: 10 });

      expect(sessions.isExpired('session-1')).toBe(false);

      await new Promise(r => setTimeout(r, 20));

      expect(sessions.isExpired('session-1')).toBe(true);
    });

    it('should return false for session without TTL', async () => {
      await sessions.create('session-1', { ttl: null });

      expect(sessions.isExpired('session-1')).toBe(false);
    });
  });

  describe('isIdle', () => {
    it('should detect idle session', async () => {
      const shortIdleManager = new SessionManager(memory, {
        defaultTTL: 10000,
        idleThreshold: 10, // 10ms
        autoCleanup: false,
      });

      await shortIdleManager.create('session-1');

      expect(shortIdleManager.isIdle('session-1')).toBe(false);

      await new Promise(r => setTimeout(r, 20));

      expect(shortIdleManager.isIdle('session-1')).toBe(true);

      shortIdleManager.destroy();
    });
  });

  describe('getTimeToLive', () => {
    it('should return remaining TTL', async () => {
      await sessions.create('session-1', { ttl: 1000 });

      const ttl = sessions.getTimeToLive('session-1');

      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(1000);
    });

    it('should return null for session without TTL', async () => {
      await sessions.create('session-1', { ttl: null });

      expect(sessions.getTimeToLive('session-1')).toBeNull();
    });
  });

  describe('expire', () => {
    it('should expire and clear session', async () => {
      await memory.add('session-1', 'user', 'Hello');
      await sessions.create('session-1');

      const result = await sessions.expire('session-1');

      expect(result).toBe(true);
      expect(sessions.getTotalCount()).toBe(0);

      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(0);
    });

    it('should call onSessionExpired callback', async () => {
      const expiredSessions: string[] = [];
      const manager = new SessionManager(memory, {
        autoCleanup: false,
        onSessionExpired: (id) => expiredSessions.push(id),
      });

      await manager.create('session-1');
      await manager.expire('session-1');

      expect(expiredSessions).toContain('session-1');

      manager.destroy();
    });
  });

  describe('list', () => {
    it('should list all sessions', async () => {
      await sessions.create('session-1');
      await sessions.create('session-2');
      await memory.add('session-1', 'user', 'Hello');

      const list = await sessions.list();

      expect(list).toHaveLength(2);
    });

    it('should filter by status', async () => {
      await sessions.create('session-1', { ttl: 10 });
      await sessions.create('session-2', { ttl: 10000 });

      await new Promise(r => setTimeout(r, 20));

      const expired = await sessions.list({ status: 'expired' });
      const active = await sessions.list({ status: 'active' });

      expect(expired.length).toBeGreaterThanOrEqual(1);
    });

    it('should filter by tags', async () => {
      await sessions.create('session-1', { tags: ['support'] });
      await sessions.create('session-2', { tags: ['sales'] });

      const support = await sessions.list({ tags: ['support'] });

      expect(support).toHaveLength(1);
      expect(support[0].sessionId).toBe('session-1');
    });

    it('should limit results', async () => {
      await sessions.create('session-1');
      await sessions.create('session-2');
      await sessions.create('session-3');

      const list = await sessions.list({ limit: 2 });

      expect(list).toHaveLength(2);
    });
  });

  describe('getByTag', () => {
    it('should get sessions by tag', async () => {
      await sessions.create('session-1', { tags: ['vip'] });
      await sessions.create('session-2', { tags: ['regular'] });

      const vip = await sessions.getByTag('vip');

      expect(vip).toHaveLength(1);
      expect(vip[0].sessionId).toBe('session-1');
    });
  });

  describe('cleanup', () => {
    it('should clean up expired sessions', async () => {
      await sessions.create('session-1', { ttl: 10 });
      await sessions.create('session-2', { ttl: 10000 });
      await memory.add('session-1', 'user', 'Will be deleted');

      await new Promise(r => setTimeout(r, 20));

      const result = await sessions.cleanup();

      expect(result.expired).toBe(1);
      expect(result.cleaned).toContain('session-1');
      expect(sessions.getTotalCount()).toBe(1);
    });
  });

  describe('counts', () => {
    it('should count active sessions', async () => {
      await sessions.create('session-1', { ttl: 10000 });
      await sessions.create('session-2', { ttl: 10000 });

      expect(sessions.getActiveCount()).toBe(2);
    });

    it('should count total sessions', async () => {
      await sessions.create('session-1');
      await sessions.create('session-2');
      await sessions.create('session-3');

      expect(sessions.getTotalCount()).toBe(3);
    });
  });

  describe('export/import', () => {
    it('should export all sessions', async () => {
      await sessions.create('session-1', { userData: { test: true } });
      await memory.add('session-1', 'user', 'Hello');

      const exported = await sessions.exportAll();

      expect(exported.size).toBe(1);
      expect(exported.get('session-1')!.metadata.userData).toEqual({ test: true });
      expect(exported.get('session-1')!.messages).toHaveLength(1);
    });

    it('should import session', async () => {
      const newManager = new SessionManager(memory, { autoCleanup: false });

      await newManager.importSession('imported', {
        metadata: {
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
          expiresAt: null,
          status: 'active',
          userData: { imported: true },
        },
        messages: [
          {
            id: 'msg-1',
            role: 'user',
            content: 'Imported message',
            timestamp: Date.now(),
          },
        ],
      });

      const metadata = await newManager.get('imported');
      expect(metadata!.userData).toEqual({ imported: true });

      const messages = await memory.getMessages('imported');
      expect(messages[0].content).toBe('Imported message');

      newManager.destroy();
    });
  });
});

describe('createSessionManager', () => {
  let memory: ContextWeaver;

  beforeEach(() => {
    memory = new ContextWeaver({ tokenLimit: 4000 });
  });

  it('should create development preset', () => {
    const sessions = createSessionManager(memory, 'development');
    expect(sessions.getTimeToLive('test')).toBeNull();
    sessions.destroy();
  });

  it('should create production preset', async () => {
    const sessions = createSessionManager(memory, 'production');
    await sessions.create('test');
    const ttl = sessions.getTimeToLive('test');
    expect(ttl).toBeGreaterThan(0);
    sessions.destroy();
  });

  it('should create aggressive preset', async () => {
    const sessions = createSessionManager(memory, 'aggressive');
    await sessions.create('test');
    const ttl = sessions.getTimeToLive('test');
    expect(ttl).toBeLessThan(3 * 60 * 60 * 1000); // Less than 3 hours
    sessions.destroy();
  });
});

describe('createSessionMiddleware', () => {
  let memory: ContextWeaver;
  let sessions: SessionManager;

  beforeEach(() => {
    memory = new ContextWeaver({ tokenLimit: 4000 });
    sessions = new SessionManager(memory, {
      defaultTTL: 1000,
      autoCleanup: false,
    });
  });

  afterEach(() => {
    sessions.destroy();
  });

  it('should wrap operations and touch session', async () => {
    await sessions.create('session-1');
    const middleware = createSessionMiddleware(sessions);

    const before = (await sessions.get('session-1'))!.lastActivityAt;

    await new Promise(r => setTimeout(r, 10));

    await middleware.wrap('session-1', async () => {
      return 'result';
    });

    const after = (await sessions.get('session-1'))!.lastActivityAt;
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('should validate and reject expired sessions', async () => {
    await sessions.create('session-1', { ttl: 10 });
    const middleware = createSessionMiddleware(sessions);

    await new Promise(r => setTimeout(r, 20));

    await expect(
      middleware.validateAndWrap('session-1', async () => 'result')
    ).rejects.toThrow('expired');
  });
});
