/**
 * Tool/Function Calling Support for ContextWeaver
 * 
 * Handles OpenAI function calling and tool use patterns.
 * Stores tool calls and results properly in conversation history.
 * 
 * @example
 * ```typescript
 * import { ToolCallHandler } from 'context-weaver';
 * 
 * const tools = new ToolCallHandler(memory);
 * 
 * // Store assistant's tool call
 * await tools.addToolCall('session-1', {
 *   id: 'call_123',
 *   name: 'get_weather',
 *   arguments: '{"city": "NYC"}'
 * });
 * 
 * // Execute and store result
 * const result = await getWeather({ city: 'NYC' });
 * await tools.addToolResult('session-1', 'call_123', result);
 * ```
 */

import type { LLMMessage } from './types.js';
import type { ContextWeaver } from './context-weaver.js';

/**
 * Tool call request from assistant
 */
export interface ToolCallRequest {
  /** Unique ID for this tool call */
  id: string;
  /** Type of tool (usually 'function') */
  type?: 'function';
  /** Function name to call */
  name: string;
  /** JSON string of arguments */
  arguments: string;
}

/**
 * Tool result to store
 */
export interface ToolResult {
  /** Tool call ID this is responding to */
  toolCallId: string;
  /** The result content (will be stringified if object) */
  content: string | object;
  /** Whether the tool call succeeded */
  success?: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Function definition for schema
 */
export interface FunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/**
 * Message with tool calls (OpenAI format)
 */
export interface AssistantToolCallMessage {
  role: 'assistant';
  content: string | null;
  tool_calls: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * Tool result message (OpenAI format)
 */
export interface ToolResultMessage {
  role: 'tool';
  tool_call_id: string;
  content: string;
}

/**
 * Options for tool call handling
 */
export interface ToolCallOptions {
  /** Store the tool call message immediately */
  autoStore?: boolean;
  /** Metadata to attach to the message */
  metadata?: Record<string, unknown>;
}

/**
 * ToolCallHandler - Manages tool/function calling in conversations
 */
export class ToolCallHandler {
  private memory: ContextWeaver;
  private pendingToolCalls: Map<string, Map<string, ToolCallRequest>> = new Map();

  constructor(memory: ContextWeaver) {
    this.memory = memory;
  }

  /**
   * Add an assistant message with tool calls
   * 
   * @example
   * ```typescript
   * // From OpenAI response
   * const assistantMessage = response.choices[0].message;
   * if (assistantMessage.tool_calls) {
   *   await tools.addToolCalls('session-1', assistantMessage.tool_calls);
   * }
   * ```
   */
  async addToolCalls(
    sessionId: string,
    toolCalls: ToolCallRequest[],
    options: ToolCallOptions = {}
  ): Promise<string> {
    const { metadata } = options;

    // Store pending tool calls
    if (!this.pendingToolCalls.has(sessionId)) {
      this.pendingToolCalls.set(sessionId, new Map());
    }
    const pending = this.pendingToolCalls.get(sessionId)!;
    
    for (const call of toolCalls) {
      pending.set(call.id, call);
    }

    // Create assistant message with tool calls info
    const toolCallsInfo = toolCalls.map(tc => 
      `[Tool Call: ${tc.name}(${tc.arguments})]`
    ).join('\n');

    const messageId = await this.memory.add(
      sessionId,
      'assistant',
      toolCallsInfo || '[Tool calls pending]',
      {
        metadata: {
          ...metadata,
          type: 'tool_calls',
          toolCalls: toolCalls.map(tc => ({
            id: tc.id,
            name: tc.name,
            arguments: tc.arguments,
          })),
        },
      }
    );

    return messageId;
  }

  /**
   * Add a single tool call
   */
  async addToolCall(
    sessionId: string,
    toolCall: ToolCallRequest,
    options: ToolCallOptions = {}
  ): Promise<string> {
    return this.addToolCalls(sessionId, [toolCall], options);
  }

  /**
   * Add a tool result
   * 
   * @example
   * ```typescript
   * // Execute the function
   * const result = await executeFunction(toolCall.name, JSON.parse(toolCall.arguments));
   * 
   * // Store the result
   * await tools.addToolResult('session-1', toolCall.id, result);
   * ```
   */
  async addToolResult(
    sessionId: string,
    toolCallId: string,
    content: string | object,
    options: { success?: boolean; error?: string; metadata?: Record<string, unknown> } = {}
  ): Promise<string> {
    const { success = true, error, metadata } = options;

    // Stringify content if needed
    const contentStr = typeof content === 'string' 
      ? content 
      : JSON.stringify(content, null, 2);

    // Remove from pending
    const pending = this.pendingToolCalls.get(sessionId);
    const toolCall = pending?.get(toolCallId);
    pending?.delete(toolCallId);

    // Store as tool message
    const messageId = await this.memory.add(
      sessionId,
      'tool',
      contentStr,
      {
        metadata: {
          ...metadata,
          type: 'tool_result',
          toolCallId,
          toolName: toolCall?.name,
          success,
          error,
        },
      }
    );

    return messageId;
  }

  /**
   * Add multiple tool results at once
   */
  async addToolResults(
    sessionId: string,
    results: ToolResult[]
  ): Promise<string[]> {
    const messageIds: string[] = [];
    
    for (const result of results) {
      const id = await this.addToolResult(
        sessionId,
        result.toolCallId,
        result.content,
        { success: result.success, error: result.error }
      );
      messageIds.push(id);
    }

    return messageIds;
  }

  /**
   * Check if there are pending tool calls
   */
  hasPendingToolCalls(sessionId: string): boolean {
    const pending = this.pendingToolCalls.get(sessionId);
    return pending ? pending.size > 0 : false;
  }

  /**
   * Get pending tool calls
   */
  getPendingToolCalls(sessionId: string): ToolCallRequest[] {
    const pending = this.pendingToolCalls.get(sessionId);
    return pending ? Array.from(pending.values()) : [];
  }

  /**
   * Clear pending tool calls
   */
  clearPendingToolCalls(sessionId: string): void {
    this.pendingToolCalls.delete(sessionId);
  }

  /**
   * Format messages for OpenAI API with proper tool call structure
   * 
   * @example
   * ```typescript
   * const { messages } = await memory.getContext('session-1');
   * const formatted = tools.formatForOpenAI(messages);
   * 
   * // Use with OpenAI
   * const response = await openai.chat.completions.create({
   *   model: 'gpt-4',
   *   messages: formatted,
   *   tools: [...],
   * });
   * ```
   */
  formatForOpenAI(messages: LLMMessage[]): Array<LLMMessage | AssistantToolCallMessage | ToolResultMessage> {
    const result: Array<LLMMessage | AssistantToolCallMessage | ToolResultMessage> = [];

    for (const msg of messages) {
      // Check if it's a tool calls message
      if (msg.role === 'assistant' && msg.content.includes('[Tool Call:')) {
        // This is a tool calls message - we need to reconstruct it
        // For now, just pass through as regular assistant message
        result.push(msg);
      } else if (msg.role === 'tool') {
        // Tool result - would need toolCallId from metadata
        result.push(msg);
      } else {
        result.push(msg);
      }
    }

    return result;
  }
}

/**
 * Execute tool calls and return results
 * 
 * @example
 * ```typescript
 * const executor = createToolExecutor({
 *   get_weather: async ({ city }) => ({ temp: 72, condition: 'sunny' }),
 *   search: async ({ query }) => ({ results: [...] }),
 * });
 * 
 * const results = await executor.execute(toolCalls);
 * await tools.addToolResults('session-1', results);
 * ```
 */
export function createToolExecutor(
  functions: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  return {
    async execute(toolCalls: ToolCallRequest[]): Promise<ToolResult[]> {
      const results: ToolResult[] = [];

      for (const call of toolCalls) {
        try {
          const fn = functions[call.name];
          if (!fn) {
            results.push({
              toolCallId: call.id,
              content: `Unknown function: ${call.name}`,
              success: false,
              error: `Function "${call.name}" not found`,
            });
            continue;
          }

          const args = JSON.parse(call.arguments);
          const result = await fn(args);

          results.push({
            toolCallId: call.id,
            content: typeof result === 'string' ? result : JSON.stringify(result),
            success: true,
          });
        } catch (error) {
          results.push({
            toolCallId: call.id,
            content: `Error: ${(error as Error).message}`,
            success: false,
            error: (error as Error).message,
          });
        }
      }

      return results;
    },

    /**
     * Execute a single tool call
     */
    async executeOne(call: ToolCallRequest): Promise<ToolResult> {
      const results = await this.execute([call]);
      return results[0]!;
    },

    /**
     * Check if a function is registered
     */
    has(name: string): boolean {
      return name in functions;
    },

    /**
     * Get list of registered function names
     */
    list(): string[] {
      return Object.keys(functions);
    },
  };
}

/**
 * Parse tool calls from OpenAI response
 */
export function parseOpenAIToolCalls(
  toolCalls: Array<{
    id: string;
    type?: string;
    function: { name: string; arguments: string };
  }>
): ToolCallRequest[] {
  return toolCalls.map(tc => ({
    id: tc.id,
    type: 'function' as const,
    name: tc.function.name,
    arguments: tc.function.arguments,
  }));
}

/**
 * Check if a message contains tool calls
 */
export function hasToolCalls(message: { tool_calls?: unknown[] }): boolean {
  return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
}

/**
 * Create a parallel tool executor that runs all tool calls concurrently
 */
export function createParallelToolExecutor(
  functions: Record<string, (args: Record<string, unknown>) => Promise<unknown>>
) {
  const executor = createToolExecutor(functions);

  return {
    ...executor,
    async execute(toolCalls: ToolCallRequest[]): Promise<ToolResult[]> {
      const promises = toolCalls.map(call => executor.executeOne(call));
      return Promise.all(promises);
    },
  };
}
