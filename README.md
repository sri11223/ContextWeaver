# 🧵 ContextWeaver

> **Smart, persistent context memory for RAG applications. Stop managing chat history arrays manually.**

[![npm version](https://badge.fury.io/js/context-weaver.svg)](https://www.npmjs.com/package/context-weaver)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

## The Problem

Building an AI chat app seems easy... until you handle "history."

```javascript
// ❌ The "hope and pray" approach
const history = await db.getMessages(userId);
const recent = history.slice(-10); // Hope this fits!
const response = await openai.chat.completions.create({
  messages: [...recent, newMessage] // What if 'recent' is too big? 💥 Crash.
});
```

**Why this breaks:**
- 🔥 **Token Limits** - You can't send unlimited history. It gets expensive and crashes.
- 🧠 **Lost Context** - Simple slicing forgets important info (user's name, goals, preferences).
- 🍝 **Spaghetti Code** - Fetching from Redis, trimming tokens, formatting for OpenAI... every single time.
- 🔒 **Framework Lock-in** - LangChain forces you to use their entire chain system just for memory.

## The Solution

```javascript
// ✅ With ContextWeaver
import { ContextWeaver } from 'context-weaver';

const memory = new ContextWeaver({ tokenLimit: 4000 });

// Add messages (fire and forget)
await memory.add(sessionId, 'user', 'My budget is $500');
await memory.add(sessionId, 'assistant', 'I can help you find options in that range!');

// Get optimized context (safe to send to LLM)
const { messages } = await memory.getContext(sessionId);

const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages, // Always fits. Never crashes. 🎯
});
```

## Features

| Feature | Description |
|---------|-------------|
| 🎯 **Token Budgeting** | Automatically trims history to fit your token limit |
| 📌 **Semantic Pinning** | Pin important messages that should never be dropped |
| 📝 **Smart Summarization** | Summarize older messages to preserve context (optional) |
| 🔌 **Pluggable Storage** | InMemory, Redis, Postgres - or bring your own |
| 🪶 **Zero Dependencies** | No LangChain, no vector DBs, just TypeScript |
| ⚡ **Drop-in Ready** | Works with OpenAI SDK, Vercel AI SDK, or raw fetch |

## Installation

```bash
npm install context-weaver
```

```bash
yarn add context-weaver
```

```bash
pnpm add context-weaver
```

## Quick Start

### Basic Usage

```typescript
import { ContextWeaver } from 'context-weaver';

// Initialize with token limit
const memory = new ContextWeaver({ 
  tokenLimit: 4000,      // Max tokens for context
  recentMessageCount: 10 // Keep at least 10 recent messages
});

// Add messages to a session
await memory.add('user-123', 'user', 'Hello! I need help planning a trip.');
await memory.add('user-123', 'assistant', 'I\'d love to help! Where are you thinking of going?');
await memory.add('user-123', 'user', 'I want to visit Japan in April.');

// Get context (always fits your token budget!)
const context = await memory.getContext('user-123');

console.log(context.messages);     // Ready for OpenAI
console.log(context.tokenCount);   // Estimated token count
console.log(context.messageCount); // Number of messages included
```

### With OpenAI SDK

```typescript
import OpenAI from 'openai';
import { ContextWeaver } from 'context-weaver';

const openai = new OpenAI();
const memory = new ContextWeaver({ tokenLimit: 4000 });

async function chat(sessionId: string, userMessage: string) {
  // Store the user's message
  await memory.add(sessionId, 'user', userMessage);
  
  // Get optimized context
  const { messages } = await memory.getContext(sessionId);
  
  // Call OpenAI
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages,
  });
  
  const assistantMessage = response.choices[0].message.content!;
  
  // Store assistant's response
  await memory.add(sessionId, 'assistant', assistantMessage);
  
  return assistantMessage;
}
```

### With Vercel AI SDK

```typescript
import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { ContextWeaver } from 'context-weaver';

const memory = new ContextWeaver({ tokenLimit: 4000 });

async function chat(sessionId: string, userMessage: string) {
  await memory.add(sessionId, 'user', userMessage);
  
  const { messages } = await memory.getContext(sessionId);
  
  const { text } = await generateText({
    model: openai('gpt-4'),
    messages,
  });
  
  await memory.add(sessionId, 'assistant', text);
  
  return text;
}
```

## Pinning Important Messages

Some messages should **never** be dropped, like system instructions or key user info:

```typescript
// Pin system instructions
const systemId = await memory.add(
  sessionId, 
  'system', 
  'You are a helpful travel assistant. The user prefers budget-friendly options.',
  { pinned: true }
);

// Or pin later
const msgId = await memory.add(sessionId, 'user', 'My name is Alice and I\'m vegetarian.');
await memory.pin(sessionId, msgId);

// Pinned messages are ALWAYS included in context, regardless of token limits
const { messages, pinnedCount } = await memory.getContext(sessionId);
console.log(`Included ${pinnedCount} pinned messages`);
```

## Smart Summarization

When conversations get long, summarize older messages to preserve context:

```typescript
import OpenAI from 'openai';
import { ContextWeaver } from 'context-weaver';

const openai = new OpenAI();

const memory = new ContextWeaver({
  tokenLimit: 4000,
  summarizeThreshold: 8000, // Auto-summarize when tokens exceed this
  
  // Provide your own summarizer
  summarizer: async (messages) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { 
          role: 'system', 
          content: 'Summarize this conversation in 2-3 sentences, preserving key facts and user preferences.' 
        },
        ...messages.map(m => ({ role: m.role, content: m.content }))
      ]
    });
    return response.choices[0].message.content!;
  }
});

// Messages will be auto-summarized when threshold is exceeded
// Or trigger manually:
await memory.summarize(sessionId);
```

## Custom Storage Adapters

### Built-in: InMemory (Default)

```typescript
import { ContextWeaver, InMemoryAdapter } from 'context-weaver';

const memory = new ContextWeaver({
  storage: new InMemoryAdapter() // Default, good for development
});
```

### Build Your Own: Redis Example

```typescript
import { ContextWeaver, StorageAdapter, Message } from 'context-weaver';
import Redis from 'ioredis';

class RedisAdapter implements StorageAdapter {
  private redis: Redis;
  
  constructor(redis: Redis) {
    this.redis = redis;
  }
  
  async getMessages(sessionId: string): Promise<Message[]> {
    const data = await this.redis.get(`context:${sessionId}:messages`);
    return data ? JSON.parse(data) : [];
  }
  
  async addMessage(sessionId: string, message: Message): Promise<void> {
    const messages = await this.getMessages(sessionId);
    messages.push(message);
    await this.redis.set(`context:${sessionId}:messages`, JSON.stringify(messages));
  }
  
  async updateMessage(sessionId: string, messageId: string, updates: Partial<Message>): Promise<void> {
    const messages = await this.getMessages(sessionId);
    const index = messages.findIndex(m => m.id === messageId);
    if (index !== -1) {
      messages[index] = { ...messages[index], ...updates };
      await this.redis.set(`context:${sessionId}:messages`, JSON.stringify(messages));
    }
  }
  
  async deleteMessage(sessionId: string, messageId: string): Promise<void> {
    const messages = await this.getMessages(sessionId);
    const filtered = messages.filter(m => m.id !== messageId);
    await this.redis.set(`context:${sessionId}:messages`, JSON.stringify(filtered));
  }
  
  async getSummary(sessionId: string): Promise<string | null> {
    return this.redis.get(`context:${sessionId}:summary`);
  }
  
  async setSummary(sessionId: string, summary: string): Promise<void> {
    await this.redis.set(`context:${sessionId}:summary`, summary);
  }
  
  async clearSession(sessionId: string): Promise<void> {
    await this.redis.del(`context:${sessionId}:messages`, `context:${sessionId}:summary`);
  }
  
  async hasSession(sessionId: string): Promise<boolean> {
    return (await this.redis.exists(`context:${sessionId}:messages`)) === 1;
  }
}

// Use it
const redis = new Redis();
const memory = new ContextWeaver({
  storage: new RedisAdapter(redis)
});
```

## Accurate Token Counting

For production, use tiktoken for accurate counts:

```typescript
import { ContextWeaver, createTiktokenCounter } from 'context-weaver';
import { encoding_for_model } from 'tiktoken';

const encoder = encoding_for_model('gpt-4');
const tokenCounter = createTiktokenCounter(encoder);

const memory = new ContextWeaver({
  tokenLimit: 4000,
  tokenCounter, // Now uses tiktoken for accurate counts
});
```

## API Reference

### `ContextWeaver`

#### Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tokenLimit` | `number` | `4000` | Maximum tokens for context output |
| `recentMessageCount` | `number` | `10` | Minimum recent messages to keep |
| `tokenCounter` | `(text: string) => number` | Built-in | Custom token counter function |
| `summarizer` | `(messages: Message[]) => Promise<string>` | `undefined` | Custom summarizer function |
| `storage` | `StorageAdapter` | `InMemoryAdapter` | Storage backend |
| `summarizeThreshold` | `number` | `tokenLimit * 2` | Auto-summarize threshold |

#### Methods

| Method | Description |
|--------|-------------|
| `add(sessionId, role, content, options?)` | Add a message |
| `getContext(sessionId, options?)` | Get optimized context |
| `pin(sessionId, messageId)` | Pin a message |
| `unpin(sessionId, messageId)` | Unpin a message |
| `summarize(sessionId, keepRecent?)` | Manually trigger summarization |
| `getMessages(sessionId)` | Get all messages |
| `getStats(sessionId)` | Get session statistics |
| `clear(sessionId)` | Clear a session |
| `hasSession(sessionId)` | Check if session exists |

## Why ContextWeaver?

| Feature | ContextWeaver | LangChain Memory | Raw Arrays |
|---------|--------------|------------------|------------|
| Zero Dependencies | ✅ | ❌ | ✅ |
| Token Budgeting | ✅ | ⚠️ Limited | ❌ |
| Semantic Pinning | ✅ | ❌ | ❌ |
| Pluggable Storage | ✅ | ✅ | ❌ |
| TypeScript Native | ✅ | ⚠️ | N/A |
| Framework Lock-in | ❌ | ✅ | ❌ |
| Production Ready | ✅ | ✅ | ❌ |

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) first.

```bash
# Clone the repo
git clone https://github.com/srikrishna/context-weaver.git
cd context-weaver

# Install dependencies
npm install

# Run tests
npm test

# Build
npm run build
```

## License

MIT © [Srikrishna](https://github.com/sri11223)

---

<p align="center">
  Built with ❤️ for the AI engineering community
</p>

<p align="center">
  <a href="https://github.com/sri11223/ContextWeaver">⭐ Star us on GitHub</a>
</p>
