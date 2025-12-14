import { describe, it, expect, beforeEach } from 'vitest';
import {
  StreamingHandler,
  createStreamAccumulator,
  wrapStream,
  extractOpenAIText,
  extractAnthropicText,
} from '../src/streaming.js';
import { ContextWeaver } from '../src/context-weaver.js';
import type { OpenAIStreamChunk, AnthropicStreamChunk } from '../src/streaming.js';

// Helper to create async iterable from array
async function* createAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

// Mock OpenAI stream chunks
function createOpenAIChunks(texts: string[]): OpenAIStreamChunk[] {
  return texts.map((text, i) => ({
    id: `chunk-${i}`,
    choices: [{
      delta: { content: text },
      finish_reason: i === texts.length - 1 ? 'stop' : null,
      index: 0,
    }],
  }));
}

// Mock Anthropic stream chunks
function createAnthropicChunks(texts: string[]): AnthropicStreamChunk[] {
  return texts.map((text) => ({
    type: 'content_block_delta',
    delta: { type: 'text_delta', text },
  }));
}

describe('StreamingHandler', () => {
  let memory: ContextWeaver;
  let streaming: StreamingHandler;

  beforeEach(() => {
    memory = new ContextWeaver({ tokenLimit: 4000 });
    streaming = new StreamingHandler(memory);
  });

  describe('handleOpenAIStream', () => {
    it('should accumulate OpenAI stream chunks', async () => {
      const chunks = createOpenAIChunks(['Hello', ' ', 'world', '!']);
      const stream = createAsyncIterable(chunks);

      const result = await streaming.handleOpenAIStream('session-1', stream);

      expect(result.content).toBe('Hello world!');
      expect(result.chunkCount).toBe(4);
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(result.hasToolCalls).toBe(false);
    });

    it('should auto-add to memory by default', async () => {
      const chunks = createOpenAIChunks(['Test', ' ', 'response']);
      const stream = createAsyncIterable(chunks);

      const result = await streaming.handleOpenAIStream('session-1', stream);

      expect(result.messageId).toBeDefined();

      // Verify message was stored
      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe('Test response');
      expect(messages[0].role).toBe('assistant');
    });

    it('should not auto-add when disabled', async () => {
      const chunks = createOpenAIChunks(['Test']);
      const stream = createAsyncIterable(chunks);

      const result = await streaming.handleOpenAIStream('session-1', stream, {
        autoAdd: false,
      });

      expect(result.messageId).toBeUndefined();
      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(0);
    });

    it('should call onChunk callback', async () => {
      const chunks = createOpenAIChunks(['A', 'B', 'C']);
      const stream = createAsyncIterable(chunks);
      const receivedChunks: string[] = [];

      await streaming.handleOpenAIStream('session-1', stream, {
        onChunk: (chunk) => receivedChunks.push(chunk),
        autoAdd: false,
      });

      expect(receivedChunks).toEqual(['A', 'B', 'C']);
    });

    it('should call onComplete callback', async () => {
      const chunks = createOpenAIChunks(['Hello', ' ', 'world']);
      const stream = createAsyncIterable(chunks);
      let completedContent = '';

      await streaming.handleOpenAIStream('session-1', stream, {
        onComplete: (content) => { completedContent = content; },
        autoAdd: false,
      });

      expect(completedContent).toBe('Hello world');
    });

    it('should handle tool calls', async () => {
      const chunksWithTools: OpenAIStreamChunk[] = [
        {
          id: 'chunk-1',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                id: 'call_123',
                type: 'function',
                function: { name: 'get_', arguments: '' },
              }],
            },
            finish_reason: null,
            index: 0,
          }],
        },
        {
          id: 'chunk-2',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { name: 'weather', arguments: '{"city":' },
              }],
            },
            finish_reason: null,
            index: 0,
          }],
        },
        {
          id: 'chunk-3',
          choices: [{
            delta: {
              tool_calls: [{
                index: 0,
                function: { arguments: '"NYC"}' },
              }],
            },
            finish_reason: 'tool_calls',
            index: 0,
          }],
        },
      ];

      const stream = createAsyncIterable(chunksWithTools);
      const result = await streaming.handleOpenAIStream('session-1', stream, {
        autoAdd: false,
      });

      expect(result.hasToolCalls).toBe(true);
      expect(result.toolCalls).toHaveLength(1);
      expect(result.toolCalls![0].id).toBe('call_123');
      expect(result.toolCalls![0].function.name).toBe('get_weather');
      expect(result.toolCalls![0].function.arguments).toBe('{"city":"NYC"}');
    });

    it('should store with custom metadata', async () => {
      const chunks = createOpenAIChunks(['Response']);
      const stream = createAsyncIterable(chunks);

      await streaming.handleOpenAIStream('session-1', stream, {
        metadata: { model: 'gpt-4', temperature: 0.7 },
      });

      const messages = await memory.getMessages('session-1');
      expect(messages[0].metadata).toEqual({ model: 'gpt-4', temperature: 0.7 });
    });

    it('should use custom role', async () => {
      const chunks = createOpenAIChunks(['System message']);
      const stream = createAsyncIterable(chunks);

      await streaming.handleOpenAIStream('session-1', stream, {
        role: 'system',
      });

      const messages = await memory.getMessages('session-1');
      expect(messages[0].role).toBe('system');
    });
  });

  describe('handleAnthropicStream', () => {
    it('should accumulate Anthropic stream chunks', async () => {
      const chunks = createAnthropicChunks(['Hello', ' from ', 'Claude']);
      const stream = createAsyncIterable(chunks);

      const result = await streaming.handleAnthropicStream('session-1', stream);

      expect(result.content).toBe('Hello from Claude');
      expect(result.chunkCount).toBe(3);
    });

    it('should auto-add to memory', async () => {
      const chunks = createAnthropicChunks(['Anthropic', ' response']);
      const stream = createAsyncIterable(chunks);

      const result = await streaming.handleAnthropicStream('session-1', stream);

      expect(result.messageId).toBeDefined();
      const messages = await memory.getMessages('session-1');
      expect(messages[0].content).toBe('Anthropic response');
    });
  });

  describe('handleTextStream', () => {
    it('should handle plain text stream', async () => {
      const texts = ['This ', 'is ', 'plain ', 'text'];
      const stream = createAsyncIterable(texts);

      const result = await streaming.handleTextStream('session-1', stream);

      expect(result.content).toBe('This is plain text');
      expect(result.chunkCount).toBe(4);
    });
  });

  describe('Manual stream handling', () => {
    it('should handle manual stream lifecycle', async () => {
      const streamId = streaming.startStream('session-1');

      streaming.addChunk(streamId, 'Manual ');
      streaming.addChunk(streamId, 'streaming ');
      streaming.addChunk(streamId, 'test');

      expect(streaming.getStreamContent(streamId)).toBe('Manual streaming test');

      const result = await streaming.endStream(streamId);

      expect(result.content).toBe('Manual streaming test');
      expect(result.chunkCount).toBe(3);
      expect(result.messageId).toBeDefined();
    });

    it('should call onChunk during manual streaming', async () => {
      const chunks: string[] = [];
      const streamId = streaming.startStream('session-1', {
        onChunk: (c) => chunks.push(c),
      });

      streaming.addChunk(streamId, 'A');
      streaming.addChunk(streamId, 'B');

      expect(chunks).toEqual(['A', 'B']);

      await streaming.endStream(streamId);
    });

    it('should cancel stream without saving', async () => {
      const streamId = streaming.startStream('session-1');
      streaming.addChunk(streamId, 'Will be cancelled');

      streaming.cancelStream(streamId);

      const messages = await memory.getMessages('session-1');
      expect(messages).toHaveLength(0);
    });

    it('should throw on invalid stream id', () => {
      expect(() => streaming.addChunk('invalid-id', 'text')).toThrow();
      expect(() => streaming.getStreamContent('invalid-id')).toThrow();
    });

    it('should track active stream count', async () => {
      expect(streaming.getActiveStreamCount()).toBe(0);

      const id1 = streaming.startStream('session-1');
      const id2 = streaming.startStream('session-2');

      expect(streaming.getActiveStreamCount()).toBe(2);

      await streaming.endStream(id1);
      expect(streaming.getActiveStreamCount()).toBe(1);

      streaming.cancelStream(id2);
      expect(streaming.getActiveStreamCount()).toBe(0);
    });
  });
});

describe('createStreamAccumulator', () => {
  it('should accumulate chunks', () => {
    const acc = createStreamAccumulator();

    acc.add('Hello');
    acc.add(' ');
    acc.add('world');

    expect(acc.getContent()).toBe('Hello world');
    expect(acc.getChunks()).toEqual(['Hello', ' ', 'world']);
    expect(acc.getChunkCount()).toBe(3);
  });

  it('should skip empty chunks', () => {
    const acc = createStreamAccumulator();

    acc.add('A');
    acc.add('');
    acc.add('B');

    expect(acc.getContent()).toBe('AB');
    expect(acc.getChunkCount()).toBe(2);
  });

  it('should clear accumulator', () => {
    const acc = createStreamAccumulator();

    acc.add('test');
    acc.clear();

    expect(acc.getContent()).toBe('');
    expect(acc.getChunkCount()).toBe(0);
  });
});

describe('wrapStream', () => {
  it('should wrap and pass through stream', async () => {
    const chunks = createOpenAIChunks(['A', 'B', 'C']);
    const stream = createAsyncIterable(chunks);
    const received: string[] = [];
    let doneContent = '';

    const wrapped = wrapStream(stream, {
      extractText: extractOpenAIText,
      onChunk: (text) => received.push(text),
      onDone: (content) => { doneContent = content; },
    });

    // Consume the wrapped stream
    const passedThrough: OpenAIStreamChunk[] = [];
    for await (const chunk of wrapped) {
      passedThrough.push(chunk);
    }

    expect(passedThrough).toHaveLength(3);
    expect(received).toEqual(['A', 'B', 'C']);
    expect(doneContent).toBe('ABC');
  });
});

describe('extractOpenAIText', () => {
  it('should extract content from OpenAI chunk', () => {
    const chunk: OpenAIStreamChunk = {
      choices: [{ delta: { content: 'Hello' }, finish_reason: null, index: 0 }],
    };
    expect(extractOpenAIText(chunk)).toBe('Hello');
  });

  it('should return null for empty content', () => {
    const chunk: OpenAIStreamChunk = {
      choices: [{ delta: {}, finish_reason: null, index: 0 }],
    };
    expect(extractOpenAIText(chunk)).toBeNull();
  });
});

describe('extractAnthropicText', () => {
  it('should extract text from Anthropic chunk', () => {
    const chunk: AnthropicStreamChunk = {
      type: 'content_block_delta',
      delta: { text: 'Hello' },
    };
    expect(extractAnthropicText(chunk)).toBe('Hello');
  });

  it('should return null for non-delta events', () => {
    const chunk: AnthropicStreamChunk = {
      type: 'message_start',
    };
    expect(extractAnthropicText(chunk)).toBeNull();
  });
});
