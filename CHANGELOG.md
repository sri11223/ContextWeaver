# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.2.0]: https://github.com/sri11223/ContextWeaver/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/sri11223/ContextWeaver/releases/tag/v0.1.0
