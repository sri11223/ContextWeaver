# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2024-11-30

### Added
- 🔴 **Redis Adapter**: Production-ready Redis storage with TTL support
  - Auto-expiry for sessions
  - Atomic operations
  - Compatible with ioredis, node-redis, and Upstash
- 🐘 **PostgreSQL Adapter**: Production-ready Postgres storage
  - ACID compliant persistence
  - Automatic table creation
  - Session expiry with cleanup
- 📊 **Hooks & Metrics System**: Full observability
  - Event emitters for all operations
  - Built-in metrics collection
  - `messageAdded`, `messagesRetrieved`, `strategyApplied` events
  - `tokenLimitApproached` warnings
  - Error tracking
  - Response time monitoring
- 🎭 **Strategy Integration**: Strategies now work with hooks
  - Context selection tracked in metrics
  - Strategy name included in results
- 🔧 **Message Importance**: Priority-based context selection
  - Add messages with `importance` score (0-1)
  - Works with `ImportanceStrategy`

### Changed
- Enhanced `ContextWeaver` class with hooks integration
- `getContext()` now returns `strategyUsed` in result
- `add()` now accepts `importance` option
- Improved TypeScript types with `ContextSelectionStrategy` interface

### Tests
- 72 tests passing (21 new hooks tests)

## [0.2.0] - 2024-11-30

### Added
- 🎯 **Smart Strategies**: Pluggable context management strategies
  - `SlidingWindowStrategy` - Keep N most recent messages
  - `TokenBudgetStrategy` - Stay within token limits
  - `ImportanceStrategy` - Score and prioritize messages
- 🔌 **More Adapters**: Additional storage options
  - Redis adapter template
  - JSON file adapter template
- 🛡️ **Error Handling**: Custom error classes with clear messages
  - `ContextWeaverError` - Base error class
  - `TokenLimitExceededError`
  - `SessionNotFoundError`
  - `StorageError`
- 📊 **Enhanced Metrics**: Better visibility into context operations
- 🧪 **Comprehensive Tests**: 50+ test cases
- 📚 **Documentation**: Contributing guide, security policy
- ⚙️ **CI/CD**: GitHub Actions for testing and publishing
- 🔧 **Code Quality**: ESLint, Prettier, publint, attw

### Changed
- Improved token counting accuracy
- Better TypeScript types with stricter checking
- Enhanced error messages

## [0.1.0] - 2024-11-30

### Added
- 🚀 Initial release
- Core `ContextWeaver` class
- Token budgeting with automatic trimming
- Semantic pinning for important messages
- Pluggable summarization
- `InMemoryAdapter` for development
- Zero dependencies
- Full TypeScript support
- ESM and CommonJS builds

[0.3.0]: https://github.com/sri11223/ContextWeaver/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/sri11223/ContextWeaver/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sri11223/ContextWeaver/releases/tag/v0.1.0
