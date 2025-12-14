/**
 * Streaming Support for ContextWeaver
 * 
 * Handles streaming responses from OpenAI, Anthropic, and other LLM providers.
 * Accumulates chunks and stores the complete message when the stream ends.
 * 
 * @example
 * ```typescript
 * import { StreamingHandler } from 'context-weaver';
 * 
 * const streaming = new StreamingHandler(memory);
 * 
 * // OpenAI streaming
 * const stream = await openai.chat.completions.create({
 *   model: 'gpt-4',
 *   messages,
 *   stream: true
 * });
 * 
 * // Accumulate and store when complete
 * const content = await streaming.handleOpenAIStream(sessionId, stream);
 * ```
 */

import type { MessageRole } from './types.js';
import type { ContextWeaver } from './context-weaver.js';
import { generateId } from './utils.js';

/**
 * Chunk from OpenAI streaming response
 */
export interface OpenAIStreamChunk {
  id?: string;
  choices: Array<{
    delta: {
      content?: string | null;
      role?: string;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string | null;
    index: number;
  }>;
}

/**
 * Chunk from Anthropic streaming response
 */
export interface AnthropicStreamChunk {
  type: string;
  index?: number;
  delta?: {
    type?: string;
    text?: string;
  };
  content_block?: {
    type: string;
    text?: string;
  };
}

/**
 * Options for stream handling
 */
export interface StreamOptions {
  /** Called for each chunk received */
  onChunk?: (chunk: string) => void;
  /** Called when stream completes */
  onComplete?: (fullContent: string) => void;
  /** Called on error */
  onError?: (error: Error) => void;
  /** Whether to automatically add to memory when complete (default: true) */
  autoAdd?: boolean;
  /** Additional metadata to store with the message */
  metadata?: Record<string, unknown>;
  /** Message role (default: 'assistant') */
  role?: MessageRole;
}

/**
 * Active stream state
 */
interface ActiveStream {
  sessionId: string;
  chunks: string[];
  startTime: number;
  role: MessageRole;
  metadata?: Record<string, unknown>;
  onChunk?: (chunk: string) => void;
  onComplete?: (fullContent: string) => void;
}

/**
 * Result of stream handling
 */
export interface StreamResult {
  /** The complete accumulated content */
  content: string;
  /** Message ID (if added to memory) */
  messageId?: string;
  /** Total chunks received */
  chunkCount: number;
  /** Duration in milliseconds */
  duration: number;
  /** Whether tool calls were detected */
  hasToolCalls: boolean;
  /** Extracted tool calls (if any) */
  toolCalls?: ToolCall[];
}

/**
 * Tool call from streaming response
 */
export interface ToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * StreamingHandler - Handles LLM streaming responses
 */
export class StreamingHandler {
  private memory: ContextWeaver;
  private activeStreams: Map<string, ActiveStream> = new Map();

  constructor(memory: ContextWeaver) {
    this.memory = memory;
  }

  /**
   * Handle an OpenAI streaming response
   * 
   * @example
   * ```typescript
   * const stream = await openai.chat.completions.create({
   *   model: 'gpt-4',
   *   messages,
   *   stream: true
   * });
   * 
   * const result = await streaming.handleOpenAIStream('session-1', stream);
   * console.log(result.content); // Full response
   * console.log(result.messageId); // Stored message ID
   * ```
   */
  async handleOpenAIStream(
    sessionId: string,
    stream: AsyncIterable<OpenAIStreamChunk>,
    options: StreamOptions = {}
  ): Promise<StreamResult> {
    const {
      onChunk,
      onComplete,
      onError,
      autoAdd = true,
      metadata,
      role = 'assistant',
    } = options;

    const startTime = Date.now();
    const chunks: string[] = [];
    const toolCalls: Map<number, ToolCall> = new Map();
    let hasToolCalls = false;

    try {
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        
        if (delta?.content) {
          chunks.push(delta.content);
          onChunk?.(delta.content);
        }

        // Handle tool calls
        if (delta?.tool_calls) {
          hasToolCalls = true;
          for (const toolCall of delta.tool_calls) {
            const existing = toolCalls.get(toolCall.index ?? 0) ?? {
              id: '',
              type: 'function',
              function: { name: '', arguments: '' },
            };

            if (toolCall.id) existing.id = toolCall.id;
            if (toolCall.type) existing.type = toolCall.type;
            if (toolCall.function?.name) existing.function.name += toolCall.function.name;
            if (toolCall.function?.arguments) existing.function.arguments += toolCall.function.arguments;

            toolCalls.set(toolCall.index ?? 0, existing);
          }
        }
      }

      const fullContent = chunks.join('');
      const duration = Date.now() - startTime;

      onComplete?.(fullContent);

      // Auto-add to memory
      let messageId: string | undefined;
      if (autoAdd && fullContent) {
        messageId = await this.memory.add(sessionId, role, fullContent, { metadata });
      }

      return {
        content: fullContent,
        messageId,
        chunkCount: chunks.length,
        duration,
        hasToolCalls,
        toolCalls: hasToolCalls ? Array.from(toolCalls.values()) : undefined,
      };
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Handle an Anthropic streaming response
   * 
   * @example
   * ```typescript
   * const stream = await anthropic.messages.create({
   *   model: 'claude-3-opus-20240229',
   *   messages,
   *   stream: true
   * });
   * 
   * const result = await streaming.handleAnthropicStream('session-1', stream);
   * ```
   */
  async handleAnthropicStream(
    sessionId: string,
    stream: AsyncIterable<AnthropicStreamChunk>,
    options: StreamOptions = {}
  ): Promise<StreamResult> {
    const {
      onChunk,
      onComplete,
      onError,
      autoAdd = true,
      metadata,
      role = 'assistant',
    } = options;

    const startTime = Date.now();
    const chunks: string[] = [];

    try {
      for await (const event of stream) {
        // Handle content_block_delta events
        if (event.type === 'content_block_delta' && event.delta?.text) {
          chunks.push(event.delta.text);
          onChunk?.(event.delta.text);
        }
        // Handle text events from some SDK versions
        if (event.type === 'text' && event.delta?.text) {
          chunks.push(event.delta.text);
          onChunk?.(event.delta.text);
        }
      }

      const fullContent = chunks.join('');
      const duration = Date.now() - startTime;

      onComplete?.(fullContent);

      // Auto-add to memory
      let messageId: string | undefined;
      if (autoAdd && fullContent) {
        messageId = await this.memory.add(sessionId, role, fullContent, { metadata });
      }

      return {
        content: fullContent,
        messageId,
        chunkCount: chunks.length,
        duration,
        hasToolCalls: false,
      };
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Handle a generic text stream (ReadableStream, AsyncIterable<string>)
   * 
   * @example
   * ```typescript
   * // From fetch response
   * const response = await fetch('/api/chat', { method: 'POST', body });
   * const result = await streaming.handleTextStream(
   *   'session-1',
   *   response.body!.pipeThrough(new TextDecoderStream())
   * );
   * ```
   */
  async handleTextStream(
    sessionId: string,
    stream: AsyncIterable<string>,
    options: StreamOptions = {}
  ): Promise<StreamResult> {
    const {
      onChunk,
      onComplete,
      onError,
      autoAdd = true,
      metadata,
      role = 'assistant',
    } = options;

    const startTime = Date.now();
    const chunks: string[] = [];

    try {
      for await (const chunk of stream) {
        chunks.push(chunk);
        onChunk?.(chunk);
      }

      const fullContent = chunks.join('');
      const duration = Date.now() - startTime;

      onComplete?.(fullContent);

      // Auto-add to memory
      let messageId: string | undefined;
      if (autoAdd && fullContent) {
        messageId = await this.memory.add(sessionId, role, fullContent, { metadata });
      }

      return {
        content: fullContent,
        messageId,
        chunkCount: chunks.length,
        duration,
        hasToolCalls: false,
      };
    } catch (error) {
      onError?.(error as Error);
      throw error;
    }
  }

  /**
   * Start accumulating a stream manually (for custom handling)
   * 
   * @example
   * ```typescript
   * const streamId = streaming.startStream('session-1');
   * 
   * socket.on('chunk', (text) => {
   *   streaming.addChunk(streamId, text);
   * });
   * 
   * socket.on('end', async () => {
   *   const result = await streaming.endStream(streamId);
   * });
   * ```
   */
  startStream(
    sessionId: string,
    options: { role?: MessageRole; metadata?: Record<string, unknown>; onChunk?: (chunk: string) => void } = {}
  ): string {
    const streamId = generateId();
    
    this.activeStreams.set(streamId, {
      sessionId,
      chunks: [],
      startTime: Date.now(),
      role: options.role ?? 'assistant',
      metadata: options.metadata,
      onChunk: options.onChunk,
    });

    return streamId;
  }

  /**
   * Add a chunk to an active stream
   */
  addChunk(streamId: string, chunk: string): void {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }
    
    stream.chunks.push(chunk);
    stream.onChunk?.(chunk);
  }

  /**
   * Get current accumulated content for a stream
   */
  getStreamContent(streamId: string): string {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }
    return stream.chunks.join('');
  }

  /**
   * End a stream and optionally save to memory
   */
  async endStream(streamId: string, options: { autoAdd?: boolean } = {}): Promise<StreamResult> {
    const stream = this.activeStreams.get(streamId);
    if (!stream) {
      throw new Error(`Stream ${streamId} not found`);
    }

    const { autoAdd = true } = options;
    const fullContent = stream.chunks.join('');
    const duration = Date.now() - stream.startTime;

    stream.onComplete?.(fullContent);

    // Auto-add to memory
    let messageId: string | undefined;
    if (autoAdd && fullContent) {
      messageId = await this.memory.add(
        stream.sessionId,
        stream.role,
        fullContent,
        { metadata: stream.metadata }
      );
    }

    // Cleanup
    this.activeStreams.delete(streamId);

    return {
      content: fullContent,
      messageId,
      chunkCount: stream.chunks.length,
      duration,
      hasToolCalls: false,
    };
  }

  /**
   * Cancel an active stream without saving
   */
  cancelStream(streamId: string): void {
    this.activeStreams.delete(streamId);
  }

  /**
   * Get count of active streams
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }
}

/**
 * Helper to create a simple streaming accumulator
 * 
 * @example
 * ```typescript
 * const accumulator = createStreamAccumulator();
 * 
 * for await (const chunk of stream) {
 *   accumulator.add(chunk.choices[0].delta.content ?? '');
 * }
 * 
 * console.log(accumulator.getContent());
 * ```
 */
export function createStreamAccumulator() {
  const chunks: string[] = [];

  return {
    add(chunk: string) {
      if (chunk) chunks.push(chunk);
    },
    getContent() {
      return chunks.join('');
    },
    getChunks() {
      return [...chunks];
    },
    getChunkCount() {
      return chunks.length;
    },
    clear() {
      chunks.length = 0;
    },
  };
}

/**
 * Wrap an async iterable to emit events
 * 
 * @example
 * ```typescript
 * const wrapped = wrapStream(openaiStream, {
 *   onChunk: (text) => process.stdout.write(text),
 *   onDone: (full) => console.log('\nDone:', full.length, 'chars'),
 * });
 * 
 * for await (const chunk of wrapped) {
 *   // chunks are passed through
 * }
 * ```
 */
export async function* wrapStream<T>(
  stream: AsyncIterable<T>,
  options: {
    extractText: (chunk: T) => string | null;
    onChunk?: (text: string) => void;
    onDone?: (fullContent: string) => void;
  }
): AsyncIterable<T> {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    const text = options.extractText(chunk);
    if (text) {
      chunks.push(text);
      options.onChunk?.(text);
    }
    yield chunk;
  }

  options.onDone?.(chunks.join(''));
}

/**
 * Extract text from OpenAI stream chunk
 */
export function extractOpenAIText(chunk: OpenAIStreamChunk): string | null {
  return chunk.choices[0]?.delta?.content ?? null;
}

/**
 * Extract text from Anthropic stream chunk
 */
export function extractAnthropicText(chunk: AnthropicStreamChunk): string | null {
  if (chunk.type === 'content_block_delta') {
    return chunk.delta?.text ?? null;
  }
  return null;
}
