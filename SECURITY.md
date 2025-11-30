# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability within ContextWeaver, please follow these steps:

1. **Do NOT open a public issue**
2. **Email the maintainer directly** at [sri11223@users.noreply.github.com]
3. **Include the following information:**
   - Type of vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Response Time**: We aim to respond within 48 hours
- **Updates**: We will keep you informed of our progress
- **Credit**: We will credit you in the security advisory (unless you prefer to remain anonymous)

## Security Best Practices for Users

### Storage Adapters

When using ContextWeaver with external storage:

```typescript
// ✅ Good: Use environment variables for credentials
const redis = new Redis(process.env.REDIS_URL);

// ❌ Bad: Hardcoded credentials
const redis = new Redis('redis://password@localhost:6379');
```

### Sensitive Data

Be mindful of what you store in conversation history:

```typescript
// ✅ Good: Sanitize sensitive data before storing
await memory.add(sessionId, 'user', sanitize(userMessage));

// ❌ Bad: Store passwords or API keys in messages
await memory.add(sessionId, 'user', `My API key is ${apiKey}`);
```

### Token Limits

Always configure appropriate token limits:

```typescript
// ✅ Good: Set reasonable limits
const memory = new ContextWeaver({ 
  tokenLimit: 4000,  // Prevents excessive memory usage
});

// ❌ Bad: No limits (potential DoS)
const memory = new ContextWeaver({ tokenLimit: Infinity });
```

## Dependencies

ContextWeaver has **zero production dependencies** to minimize attack surface.

## Updates

We recommend always using the latest version of ContextWeaver to ensure you have the latest security patches.

```bash
npm update context-weaver
```
