# Example: ContextWeaver with OpenAI

This example shows how to use ContextWeaver with the OpenAI SDK in a simple chat application.

## Setup

```bash
npm install context-weaver openai
```

## Code

```typescript
import OpenAI from 'openai';
import { ContextWeaver } from 'context-weaver';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize ContextWeaver with smart summarization
const memory = new ContextWeaver({
  tokenLimit: 4000,
  recentMessageCount: 10,
  summarizeThreshold: 8000,
  
  // Use GPT-3.5 for cost-effective summarization
  summarizer: async (messages) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: 'Summarize this conversation in 2-3 sentences. Preserve key facts, user preferences, and important decisions.',
        },
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      ],
      max_tokens: 200,
    });
    return response.choices[0]?.message?.content ?? 'Unable to generate summary.';
  },
});

/**
 * Chat function that handles context management automatically
 */
async function chat(sessionId: string, userMessage: string): Promise<string> {
  // 1. Add user message to memory
  await memory.add(sessionId, 'user', userMessage);

  // 2. Get optimized context (always fits token limit!)
  const { messages, tokenCount } = await memory.getContext(sessionId);
  console.log(`Sending ${messages.length} messages (${tokenCount} tokens)`);

  // 3. Call OpenAI
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages,
  });

  const assistantMessage = response.choices[0]?.message?.content ?? 'No response';

  // 4. Store assistant response
  await memory.add(sessionId, 'assistant', assistantMessage);

  return assistantMessage;
}

/**
 * Set up a new session with system instructions
 */
async function setupSession(sessionId: string, systemPrompt: string): Promise<void> {
  // Add pinned system message (never gets dropped)
  await memory.add(sessionId, 'system', systemPrompt, { pinned: true });
}

// Example usage
async function main() {
  const sessionId = 'user-123';

  // Setup session with system instructions
  await setupSession(
    sessionId,
    'You are a helpful travel planning assistant. Be concise and practical.'
  );

  // Have a conversation
  console.log('User: I want to plan a trip to Japan');
  const r1 = await chat(sessionId, 'I want to plan a trip to Japan');
  console.log('Assistant:', r1);

  console.log('\nUser: My budget is around $3000');
  const r2 = await chat(sessionId, 'My budget is around $3000');
  console.log('Assistant:', r2);

  console.log('\nUser: I prefer cultural experiences over tourist spots');
  const r3 = await chat(sessionId, 'I prefer cultural experiences over tourist spots');
  console.log('Assistant:', r3);

  // Check stats
  const stats = await memory.getStats(sessionId);
  console.log('\n--- Session Stats ---');
  console.log(`Total messages: ${stats.totalMessages}`);
  console.log(`Pinned messages: ${stats.pinnedMessages}`);
  console.log(`Estimated tokens: ${stats.estimatedTokens}`);
  console.log(`Has summary: ${stats.hasSummary}`);
}

main().catch(console.error);
```

## Key Concepts

### 1. Token Safety
```typescript
const { messages } = await memory.getContext(sessionId);
// 'messages' is GUARANTEED to fit within tokenLimit
// No more crashes from exceeding context limits!
```

### 2. Pinned Messages
```typescript
// System prompts should be pinned so they're never dropped
await memory.add(sessionId, 'system', 'You are helpful...', { pinned: true });

// Pin important user info
const id = await memory.add(sessionId, 'user', 'My name is Alice');
await memory.pin(sessionId, id);
```

### 3. Smart Summarization
When the conversation gets long, older messages are automatically summarized:

```typescript
// Context might look like:
[
  { role: 'system', content: 'Previous summary: User wants to visit Japan with $3000 budget...' },
  { role: 'system', content: 'You are a helpful travel assistant.' },  // Pinned
  { role: 'user', content: 'What about accommodations?' },  // Recent
  { role: 'assistant', content: 'For Japan on $3000...' },  // Recent
]
```

## Running This Example

1. Create a `.env` file:
```
OPENAI_API_KEY=your-key-here
```

2. Run:
```bash
npx tsx examples/openai-chat.ts
```
