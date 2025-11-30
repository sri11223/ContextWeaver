# Contributing to ContextWeaver

First off, thank you for considering contributing to ContextWeaver! 🎉

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### 🐛 Reporting Bugs

Before creating bug reports, please check existing issues. When you create a bug report, include as many details as possible:

- **Use a clear and descriptive title**
- **Describe the exact steps to reproduce the problem**
- **Provide specific examples** (code snippets, error messages)
- **Describe the behavior you observed and what you expected**
- **Include your environment** (Node.js version, OS, etc.)

### 💡 Suggesting Features

Feature suggestions are welcome! Please:

- **Use a clear and descriptive title**
- **Provide a detailed description** of the proposed feature
- **Explain why this feature would be useful**
- **Include code examples** of how it might work

### 🔧 Pull Requests

1. **Fork the repo** and create your branch from `main`
2. **Install dependencies**: `npm install`
3. **Make your changes**
4. **Add tests** for any new functionality
5. **Ensure tests pass**: `npm test`
6. **Ensure linting passes**: `npm run lint`
7. **Ensure types check**: `npm run typecheck`
8. **Update documentation** if needed
9. **Submit your PR**

## Development Setup

```bash
# Clone your fork
git clone https://github.com/YOUR_USERNAME/ContextWeaver.git
cd ContextWeaver

# Install dependencies
npm install

# Run tests
npm test

# Run tests in watch mode
npm run test:watch

# Build the project
npm run build

# Lint the code
npm run lint

# Format the code
npm run format

# Type check
npm run typecheck
```

## Project Structure

```
ContextWeaver/
├── src/
│   ├── adapters/          # Storage adapters (InMemory, Redis, etc.)
│   ├── strategies/        # Context strategies (sliding window, importance, etc.)
│   ├── context-weaver.ts  # Main ContextWeaver class
│   ├── token-counter.ts   # Token counting utilities
│   ├── types.ts           # TypeScript interfaces
│   ├── errors.ts          # Custom error classes
│   └── index.ts           # Public exports
├── tests/                 # Test files
├── examples/              # Usage examples
└── docs/                  # Documentation
```

## Coding Standards

### TypeScript

- Use strict TypeScript (`strict: true`)
- Prefer `interface` over `type` for object shapes
- Export types alongside implementations
- Use explicit return types for public methods

### Style

- Use ESLint and Prettier (run `npm run lint` and `npm run format`)
- Use meaningful variable names
- Write JSDoc comments for public APIs
- Keep functions small and focused

### Testing

- Write tests for all new features
- Aim for high test coverage
- Use descriptive test names
- Test edge cases and error conditions

### Commits

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

Example:
```
feat: add Redis storage adapter
fix: handle empty session gracefully
docs: add example for Vercel AI SDK
```

## Review Process

1. All PRs require at least one review
2. CI must pass (tests, linting, type checking)
3. Documentation must be updated for new features
4. Breaking changes need discussion first

## Need Help?

- Open an issue with the `question` label
- Check existing issues and discussions
- Read the documentation

Thank you for contributing! 🙏
