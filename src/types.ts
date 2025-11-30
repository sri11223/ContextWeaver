/**
 * Message roles compatible with OpenAI/Anthropic APIs
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'function' | 'tool';

/**
 * A single message in the conversation history
 */
export interface Message {
  /** Unique identifier for the message */
  id: string;
  /** The role of the message sender */
  role: MessageRole;
  /** The content of the message */
  content: string;
  /** Timestamp when the message was created */
  timestamp: number;
  /** Whether this message is pinned (won't be summarized/dropped) */
  pinned?: boolean;
  /** Optional metadata for the message */
  metadata?: Record<string, unknown>;
}

/**
 * A simplified message format for LLM API calls
 * Compatible with OpenAI ChatCompletionMessageParam
 */
export interface LLMMessage {
  role: MessageRole;
  content: string;
}

/**
 * Options for retrieving context
 */
export interface GetContextOptions {
  /** Maximum tokens to return (default: configured tokenLimit) */
  maxTokens?: number;
  /** Include pinned messages (default: true) */
  includePinned?: boolean;
  /** Include summary of older messages (default: true) */
  includeSummary?: boolean;
  /** Format output for specific provider */
  format?: 'openai' | 'anthropic' | 'raw';
}

/**
 * Result of a getContext operation with metadata
 */
export interface ContextResult {
  /** Messages ready to send to LLM */
  messages: LLMMessage[];
  /** Estimated token count */
  tokenCount: number;
  /** Number of messages included */
  messageCount: number;
  /** Whether older messages were summarized */
  wasSummarized: boolean;
  /** Number of pinned messages included */
  pinnedCount: number;
}

/**
 * Function type for summarizing messages
 * User can provide their own summarizer (e.g., using OpenAI)
 */
export type SummarizerFunction = (messages: Message[]) => Promise<string>;

/**
 * Function type for counting tokens
 * User can provide their own token counter for accuracy
 */
export type TokenCounterFunction = (text: string) => number;

/**
 * Configuration options for ContextWeaver
 */
export interface ContextWeaverOptions {
  /** Maximum tokens for context output (default: 4000) */
  tokenLimit?: number;
  /** Number of recent messages to always keep (default: 10) */
  recentMessageCount?: number;
  /** Custom token counter function */
  tokenCounter?: TokenCounterFunction;
  /** Custom summarizer function (required for summarization) */
  summarizer?: SummarizerFunction;
  /** Storage adapter (default: InMemoryAdapter) */
  storage?: StorageAdapter;
  /** Auto-summarize when history exceeds this token count */
  summarizeThreshold?: number;
}

/**
 * Storage adapter interface for pluggable persistence
 */
export interface StorageAdapter {
  /** Get all messages for a session */
  getMessages(sessionId: string): Promise<Message[]>;
  /** Add a message to a session */
  addMessage(sessionId: string, message: Message): Promise<void>;
  /** Update a message (e.g., for pinning) */
  updateMessage(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void>;
  /** Delete a message */
  deleteMessage(sessionId: string, messageId: string): Promise<void>;
  /** Get the summary for a session */
  getSummary(sessionId: string): Promise<string | null>;
  /** Set the summary for a session */
  setSummary(sessionId: string, summary: string): Promise<void>;
  /** Clear all messages for a session */
  clearSession(sessionId: string): Promise<void>;
  /** Check if a session exists */
  hasSession(sessionId: string): Promise<boolean>;
}

/**
 * Session statistics
 */
export interface SessionStats {
  /** Total number of messages */
  totalMessages: number;
  /** Number of pinned messages */
  pinnedMessages: number;
  /** Estimated total tokens */
  estimatedTokens: number;
  /** Whether a summary exists */
  hasSummary: boolean;
  /** Oldest message timestamp */
  oldestMessage?: number;
  /** Newest message timestamp */
  newestMessage?: number;
}
