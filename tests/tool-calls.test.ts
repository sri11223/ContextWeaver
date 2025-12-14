import { describe, it, expect, beforeEach } from 'vitest';
import {
  ToolCallHandler,
  createToolExecutor,
  createParallelToolExecutor,
  parseOpenAIToolCalls,
  hasToolCalls,
} from '../src/tool-calls.js';
import { ContextWeaver } from '../src/context-weaver.js';

describe('ToolCallHandler', () => {
  let memory: ContextWeaver;
  let tools: ToolCallHandler;

  beforeEach(() => {
    memory = new ContextWeaver({ tokenLimit: 4000 });
    tools = new ToolCallHandler(memory);
  });

  describe('addToolCalls', () => {
    it('should store tool call as assistant message', async () => {
      const messageId = await tools.addToolCall('session-1', {
        id: 'call_123',
        name: 'get_weather',
        arguments: '{"city": "NYC"}',
      });

      expect(messageId).toBeDefined();

      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe('assistant');
      expect(messages[0].content).toContain('get_weather');
    });

    it('should store multiple tool calls', async () => {
      await tools.addToolCalls('session-1', [
        { id: 'call_1', name: 'get_weather', arguments: '{"city": "NYC"}' },
        { id: 'call_2', name: 'get_time', arguments: '{"timezone": "EST"}' },
      ]);

      const messages = await memory.getMessages('session-1');
      expect(messages[0].content).toContain('get_weather');
      expect(messages[0].content).toContain('get_time');
    });

    it('should track pending tool calls', async () => {
      await tools.addToolCall('session-1', {
        id: 'call_123',
        name: 'get_weather',
        arguments: '{}',
      });

      expect(tools.hasPendingToolCalls('session-1')).toBe(true);
      
      const pending = tools.getPendingToolCalls('session-1');
      expect(pending).toHaveLength(1);
      expect(pending[0].name).toBe('get_weather');
    });
  });

  describe('addToolResult', () => {
    it('should store tool result', async () => {
      await tools.addToolCall('session-1', {
        id: 'call_123',
        name: 'get_weather',
        arguments: '{"city": "NYC"}',
      });

      await tools.addToolResult('session-1', 'call_123', { temp: 72, condition: 'sunny' });

      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(2);
      expect(messages[1].role).toBe('tool');
      expect(messages[1].content).toContain('72');
    });

    it('should remove from pending after result', async () => {
      await tools.addToolCall('session-1', {
        id: 'call_123',
        name: 'get_weather',
        arguments: '{}',
      });

      expect(tools.hasPendingToolCalls('session-1')).toBe(true);

      await tools.addToolResult('session-1', 'call_123', 'result');

      expect(tools.hasPendingToolCalls('session-1')).toBe(false);
    });

    it('should store string content directly', async () => {
      await tools.addToolResult('session-1', 'call_123', 'Simple string result');

      const messages = await memory.getMessages('session-1');
      expect(messages[0].content).toBe('Simple string result');
    });

    it('should store error info in metadata', async () => {
      await tools.addToolResult('session-1', 'call_123', 'Error message', {
        success: false,
        error: 'Network timeout',
      });

      const messages = await memory.getMessages('session-1');
      expect(messages[0].metadata?.success).toBe(false);
      expect(messages[0].metadata?.error).toBe('Network timeout');
    });
  });

  describe('addToolResults', () => {
    it('should add multiple results', async () => {
      await tools.addToolResults('session-1', [
        { toolCallId: 'call_1', content: 'Result 1' },
        { toolCallId: 'call_2', content: 'Result 2' },
      ]);

      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(2);
    });
  });

  describe('clearPendingToolCalls', () => {
    it('should clear pending calls', async () => {
      await tools.addToolCall('session-1', {
        id: 'call_123',
        name: 'test',
        arguments: '{}',
      });

      expect(tools.hasPendingToolCalls('session-1')).toBe(true);

      tools.clearPendingToolCalls('session-1');

      expect(tools.hasPendingToolCalls('session-1')).toBe(false);
    });
  });
});

describe('createToolExecutor', () => {
  it('should execute registered functions', async () => {
    const executor = createToolExecutor({
      greet: async ({ name }) => `Hello, ${name}!`,
    });

    const results = await executor.execute([
      { id: 'call_1', name: 'greet', arguments: '{"name": "World"}' },
    ]);

    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(true);
    expect(results[0].content).toBe('Hello, World!');
  });

  it('should handle unknown functions', async () => {
    const executor = createToolExecutor({});

    const results = await executor.execute([
      { id: 'call_1', name: 'unknown_function', arguments: '{}' },
    ]);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toContain('not found');
  });

  it('should handle function errors', async () => {
    const executor = createToolExecutor({
      failing: async () => {
        throw new Error('Function failed');
      },
    });

    const results = await executor.execute([
      { id: 'call_1', name: 'failing', arguments: '{}' },
    ]);

    expect(results[0].success).toBe(false);
    expect(results[0].error).toBe('Function failed');
  });

  it('should stringify object results', async () => {
    const executor = createToolExecutor({
      getObject: async () => ({ key: 'value' }),
    });

    const results = await executor.execute([
      { id: 'call_1', name: 'getObject', arguments: '{}' },
    ]);

    expect(results[0].content).toContain('key');
    expect(results[0].content).toContain('value');
  });

  it('should execute single tool call', async () => {
    const executor = createToolExecutor({
      add: async ({ a, b }) => (a as number) + (b as number),
    });

    const result = await executor.executeOne({
      id: 'call_1',
      name: 'add',
      arguments: '{"a": 2, "b": 3}',
    });

    expect(result.content).toBe('5');
  });

  it('should check if function exists', () => {
    const executor = createToolExecutor({
      exists: async () => {},
    });

    expect(executor.has('exists')).toBe(true);
    expect(executor.has('not_exists')).toBe(false);
  });

  it('should list registered functions', () => {
    const executor = createToolExecutor({
      func1: async () => {},
      func2: async () => {},
    });

    expect(executor.list()).toEqual(['func1', 'func2']);
  });
});

describe('createParallelToolExecutor', () => {
  it('should execute functions in parallel', async () => {
    const executionOrder: string[] = [];

    const executor = createParallelToolExecutor({
      slow: async () => {
        await new Promise(r => setTimeout(r, 50));
        executionOrder.push('slow');
        return 'slow result';
      },
      fast: async () => {
        executionOrder.push('fast');
        return 'fast result';
      },
    });

    const results = await executor.execute([
      { id: 'call_1', name: 'slow', arguments: '{}' },
      { id: 'call_2', name: 'fast', arguments: '{}' },
    ]);

    expect(results).toHaveLength(2);
    // Fast should complete before slow
    expect(executionOrder).toEqual(['fast', 'slow']);
  });
});

describe('parseOpenAIToolCalls', () => {
  it('should parse OpenAI format', () => {
    const openAIToolCalls = [
      {
        id: 'call_abc123',
        type: 'function' as const,
        function: {
          name: 'get_weather',
          arguments: '{"city": "NYC"}',
        },
      },
    ];

    const parsed = parseOpenAIToolCalls(openAIToolCalls);

    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('call_abc123');
    expect(parsed[0].name).toBe('get_weather');
    expect(parsed[0].arguments).toBe('{"city": "NYC"}');
  });
});

describe('hasToolCalls', () => {
  it('should detect tool calls', () => {
    expect(hasToolCalls({ tool_calls: [{}] })).toBe(true);
    expect(hasToolCalls({ tool_calls: [] })).toBe(false);
    expect(hasToolCalls({})).toBe(false);
  });
});
