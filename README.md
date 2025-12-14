# 🧵 ContextWeaver

> **Stop getting "Token Limit Exceeded" errors in your AI chatbot. Smart context management that just works.**

[![npm version](https://badge.fury.io/js/context-weaver.svg)](https://www.npmjs.com/package/context-weaver)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

**v1.0.0 - Production Ready** • Zero Dependencies • 253 Tests • TypeScript

---

## ⚡ Quick Start (30 seconds)

```bash
npm install context-weaver
```

```typescript
import { ContextWeaver } from 'context-weaver';
import OpenAI from 'openai';

const openai = new OpenAI();
const memory = new ContextWeaver({ tokenLimit: 4000 });

// Add messages
await memory.add('user-123', 'user', 'My budget is $500');
await memory.add('user-123', 'assistant', 'I can help you find options!');

// Get context (always fits token limit!)
const { messages } = await memory.getContext('user-123');

// Send to OpenAI
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages // ✅ Never crashes. Always fits.
});
```

**That's it! No token counting. No manual trimming. No crashes.** 🎉

---

## ❌ The Problem

Every AI developer hits this wall:

```javascript
// Your chatbot code
const history = await getMessages(userId);
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages: history // 💥 Error: "maximum context length exceeded"
});
```

**What goes wrong:**
1. 🔥 **Token limit crashes** - Conversation gets too long, app crashes
2. 🧠 **Lost context** - Slicing messages loses user's name, goals, preferences
3. 🍝 **Complex code** - Token counting, Redis management, manual cleanup
4. ⏰ **Wastes dev time** - Spend days building what should take minutes

---

## ✅ The Solution

**ContextWeaver manages conversation history automatically:**

```javascript
import { ContextWeaver } from 'context-weaver';

const memory = new ContextWeaver({ tokenLimit: 4000 });

// Add messages - simple!
await memory.add('user-123', 'user', 'My name is Alice');
await memory.add('user-123', 'user', 'My budget is $500');
// ... 50 more messages later ...

// Get context - always fits!
const { messages } = await memory.getContext('user-123');

// Send to AI - never crashes!
const response = await openai.chat.completions.create({
  model: 'gpt-4',
  messages // ✅ Guaranteed to fit. Keeps important stuff.
});
```

**What it does:**
- ✅ **Auto token management** - Always fits your limit
- ✅ **Smart selection** - Keeps important messages (name, budget, goals)
- ✅ **Drops filler** - Removes "ok", "thanks", empty messages
- ✅ **Zero dependencies** - No heavy frameworks
- ✅ **Production ready** - Sessions, TTL, Redis, Postgres

---

## 🎯 Features

| What You Get | Why It Matters |
|--------------|----------------|
| 🧠 **Smart Context** | Keeps important messages, drops filler automatically |
| 🎯 **Token Budgeting** | Never exceed your token limit, no math needed |
| 💬 **Conversation Pairs** | Q&A stay together ("explain step 2" just works) |
| 🔌 **Storage Adapters** | Redis, Postgres, or in-memory - your choice |
| 📝 **Streaming Support** | OpenAI, Anthropic, Google - all handled |
| 🔄 **Session Management** | Auto-cleanup, TTL, background jobs included |
| 📊 **Observability** | Hooks for logging, metrics, monitoring |
| 🪶 **Lightweight** | Zero dependencies, 347 KB package |

---

## 📦 Installation

```bash
npm install context-weaver
```

---

## 🚀 Usage Examples

### Basic Chat (Copy-Paste Ready)

```typescript
import { ContextWeaver } from 'context-weaver';
import OpenAI from 'openai';

const openai = new OpenAI();
const memory = new ContextWeaver({ tokenLimit: 4000 });

async function chat(userId: string, message: string) {
  // 1. Add user message
  await memory.add(userId, 'user', message);
  
  // 2. Get optimized context (always fits!)
  const { messages } = await memory.getContext(userId);
  
  // 3. Send to AI
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages
  });
  
  const reply = response.choices[0].message.content;
  
  // 4. Save AI response
  await memory.add(userId, 'assistant', reply);
  
  return reply;
}

// Use it
await chat('user-123', 'Hello! My budget is $500');
await chat('user-123', 'Show me laptops');
```

---

### Smart Mode (Auto-Importance)

```typescript
import { SmartContextWeaver } from 'context-weaver/smart';

const memory = new SmartContextWeaver(); // Zero config!

// Add messages - it figures out what's important
await memory.add('user-123', 'user', 'My name is Bob and my budget is $1000');
await memory.add('user-123', 'user', 'ok cool');
await memory.add('user-123', 'user', 'Show me gaming laptops');

// Get smart context
const { messages } = await memory.getContext('user-123', {
  currentQuery: 'Show me gaming laptops'
});
// ✅ Keeps: name, budget
// ✅ Drops: "ok cool"
```

---

### Production Setup (Redis)

```typescript
import { ContextWeaver, RedisAdapter } from 'context-weaver';
import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

const memory = new ContextWeaver({
  storage: new RedisAdapter(redis, { 
    ttl: 86400 // 24 hours
  }),
  tokenLimit: 8000
});

// Now all messages stored in Redis with auto-expiry!
await memory.add('user-456', 'user', 'Hello');
```

---

### Streaming (OpenAI/Anthropic)

```typescript
const stream = await openai.chat.completions.create({
  model: 'gpt-4',
  messages,
  stream: true
});

// One line - handles all streaming complexity!
await memory.addStream('user-789', 'assistant', stream);
```

---

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

### `SmartContextWeaver` (v0.4+)

The smart, zero-config context manager with auto-importance detection.

```typescript
import { SmartContextWeaver } from 'context-weaver/smart';

const memory = new SmartContextWeaver({
  tokenLimit: 4000,            // Optional: default 4000
  enableSemantic: true,        // Optional: enable semantic search
  enableAutoImportance: true,  // Optional: auto-detect important messages
  enableLocalSummary: true,    // Optional: local summarization
  enableConversationPairs: true, // NEW v0.5: Keep Q&A together
  minRecentPairs: 3,           // NEW v0.5: Min pairs to always keep
});
```

#### Conversation Pairs (v0.5+)

When users say things like "explain step 2" or "go with option B", the AI needs the original context. Conversation Pairs ensures Q&A stay together:

```typescript
import { 
  SmartContextWeaver,
  ConversationPairManager,
  hasConversationReference 
} from 'context-weaver/smart';

// The manager builds pairs from messages
const pairManager = new ConversationPairManager();
const pairs = pairManager.buildPairs(messages);

// Check if a query references previous content
if (hasConversationReference('explain step 2')) {
  // Automatically finds and includes the pair with steps
}

// Or just use SmartContextWeaver with pairs enabled
const memory = new SmartContextWeaver({
  enableConversationPairs: true
});
```

**Reference patterns detected:**
- Numbered: "step 2", "option 1", "point 3"
- Ordinal: "the first one", "the last thing"
- Back-reference: "you mentioned", "as you said before"
- Continuation: "tell me more", "explain that"
- Demonstrative: "that approach", "this method"

#### Smart Utilities

| Import | Description |
|--------|-------------|
| `LRUCache<K,V>` | O(1) LRU cache with TTL |
| `TokenCache` | Specialized token count cache |
| `BloomFilter` | Fast probabilistic set |
| `AutoImportance` | Importance detection |
| `SemanticIndex` | TF-IDF semantic search |
| `LocalSummarizer` | API-free summarization |

## Why ContextWeaver?

| Feature | ContextWeaver | LangChain Memory | Raw Arrays |
|---------|--------------|------------------|------------|
| Zero Dependencies | ✅ | ❌ | ✅ |
| Token Budgeting | ✅ | ⚠️ Limited | ❌ |
| Auto-Importance | ✅ | ❌ | ❌ |
| Semantic Search | ✅ | ⚠️ Needs VectorDB | ❌ |
| Local Summarization | ✅ | ❌ | ❌ |
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