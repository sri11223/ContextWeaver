# Production Setup with Redis & Observability

This example shows how to set up `context-weaver` for production with Redis, hooks, and metrics.

## Installation

```bash
npm install context-weaver ioredis
# or
npm install context-weaver redis
```

## Redis Setup

```typescript
import { ContextWeaver, RedisAdapter, ContextWeaverHooks } from 'context-weaver';
import Redis from 'ioredis';

// Create Redis client
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

// Create adapter with TTL (24 hours auto-expiry)
const adapter = new RedisAdapter({
  client: redis,
  keyPrefix: 'context-weaver:',
  sessionTTL: 86400,      // 24 hours
  enableExpiry: true,     // Auto-expire sessions
});

// Create hooks for observability
const hooks = new ContextWeaverHooks();

// Create ContextWeaver instance
const memory = new ContextWeaver({
  storage: adapter,
  tokenLimit: 8000,
  hooks,
});
```

## PostgreSQL Setup

```typescript
import { ContextWeaver, PostgresAdapter } from 'context-weaver';
import { Pool } from 'pg';

// Create Postgres pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20, // Connection pool size
});

// Create adapter
const adapter = new PostgresAdapter({
  client: pool,
  messagesTable: 'context_weaver_messages',
  summariesTable: 'context_weaver_summaries',
  sessionTTL: 86400,
  enableExpiry: true,
});

// Initialize tables (run once on startup)
await adapter.initialize();

const memory = new ContextWeaver({
  storage: adapter,
  tokenLimit: 8000,
});
```

## Observability & Metrics

```typescript
import {
  ContextWeaver,
  ContextWeaverHooks,
  createConsoleLogHook,
  createMetricsReporter,
} from 'context-weaver';

const hooks = new ContextWeaverHooks();

// 1. Console logging (development)
hooks.onAny(createConsoleLogHook());

// 2. Custom event handling
hooks.on('messageAdded', async (payload) => {
  console.log(`New message in ${payload.sessionId}`);
  
  // Send to analytics
  await analytics.track('message_added', {
    sessionId: payload.sessionId,
    role: payload.message.role,
  });
});

// 3. Token limit warnings
hooks.on('tokenLimitApproached', (payload) => {
  console.warn(`⚠️ Session ${payload.sessionId} at ${payload.usagePercentage.toFixed(1)}% capacity`);
  
  // Alert monitoring system
  alerting.warn('token_limit_approaching', payload);
});

// 4. Error tracking
hooks.on('error', async (payload) => {
  console.error(`Error in ${payload.operation}:`, payload.error);
  
  // Send to error tracking (Sentry, etc.)
  Sentry.captureException(payload.error, {
    tags: { operation: payload.operation },
    extra: { sessionId: payload.sessionId },
  });
});

// 5. Periodic metrics reporting
const reporter = createMetricsReporter(
  (metrics) => {
    // Send to your metrics backend (DataDog, Prometheus, etc.)
    datadog.gauge('context_weaver.messages_added', metrics.messagesAdded);
    datadog.gauge('context_weaver.tokens_processed', metrics.tokensProcessed);
    datadog.gauge('context_weaver.active_sessions', metrics.activeSessions);
    datadog.gauge('context_weaver.avg_response_time', metrics.averageResponseTime);
  },
  hooks,
  60000 // Report every minute
);

reporter.start();

// Use with ContextWeaver
const memory = new ContextWeaver({
  storage: adapter,
  tokenLimit: 8000,
  hooks,
});
```

## Strategy Selection

```typescript
import {
  ContextWeaver,
  SlidingWindowStrategy,
  TokenBudgetStrategy,
  ImportanceStrategy,
  CompositeStrategy,
} from 'context-weaver';

// 1. Sliding Window - Keep most recent N messages
const slidingWindow = new SlidingWindowStrategy({ windowSize: 20 });

// 2. Token Budget - Optimize for token usage
const tokenBudget = new TokenBudgetStrategy({
  reserveForPinned: 0.2, // Reserve 20% for pinned messages
});

// 3. Importance-based - Prioritize important messages
const importance = new ImportanceStrategy({
  defaultImportance: 0.5,
  importanceField: 'importance',
});

// 4. Composite - Combine multiple strategies
const composite = new CompositeStrategy([
  { strategy: importance, weight: 0.7 },
  { strategy: slidingWindow, weight: 0.3 },
]);

const memory = new ContextWeaver({
  storage: adapter,
  tokenLimit: 8000,
  strategy: composite,
});
```

## Full Production Example

```typescript
import { ContextWeaver, RedisAdapter, ContextWeaverHooks, ImportanceStrategy } from 'context-weaver';
import Redis from 'ioredis';
import OpenAI from 'openai';

// Setup
const redis = new Redis(process.env.REDIS_URL!);
const openai = new OpenAI();
const hooks = new ContextWeaverHooks();

// Configure hooks
hooks.on('tokenLimitApproached', (p) => {
  console.warn(`Session ${p.sessionId} at ${p.usagePercentage}%`);
});

const memory = new ContextWeaver({
  storage: new RedisAdapter({ client: redis, sessionTTL: 86400 }),
  tokenLimit: 8000,
  strategy: new ImportanceStrategy({ defaultImportance: 0.5 }),
  hooks,
  summarizer: async (messages) => {
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'Summarize this conversation in 2-3 sentences.' },
        ...messages.map(m => ({ role: m.role, content: m.content })),
      ],
      max_tokens: 200,
    });
    return response.choices[0].message.content!;
  },
});

// API Route Handler (Express/Next.js/etc.)
async function handleChat(sessionId: string, userMessage: string) {
  // Add user message with importance
  await memory.add(sessionId, 'user', userMessage, {
    importance: detectImportance(userMessage), // Your logic
  });
  
  // Get optimized context
  const context = await memory.getContext(sessionId);
  
  // Call LLM
  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: context.messages,
  });
  
  const assistantMessage = response.choices[0].message.content!;
  
  // Store response
  await memory.add(sessionId, 'assistant', assistantMessage);
  
  // Get metrics
  const metrics = hooks.getMetrics();
  console.log(`Active sessions: ${metrics.activeSessions}`);
  
  return assistantMessage;
}

function detectImportance(message: string): number {
  // Simple heuristic - customize based on your needs
  const importantKeywords = ['important', 'remember', 'note', 'always'];
  return importantKeywords.some(k => message.toLowerCase().includes(k)) ? 1.0 : 0.5;
}
```

## Environment Variables

```bash
# Redis
REDIS_URL=redis://localhost:6379

# PostgreSQL  
DATABASE_URL=postgresql://user:password@localhost:5432/mydb

# OpenAI
OPENAI_API_KEY=sk-...
```

## Health Checks

```typescript
// Add to your health check endpoint
async function healthCheck() {
  const sessionExists = await memory.hasSession('__health_check__');
  const metrics = hooks.getMetrics();
  
  return {
    healthy: true,
    sessions: metrics.sessionCount,
    activeSessions: metrics.activeSessions,
    errors: metrics.errors,
    avgResponseTime: metrics.averageResponseTime,
  };
}
```
