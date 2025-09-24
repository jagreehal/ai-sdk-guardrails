---
"ai-sdk-guardrails": major
---

BREAKING: Fix import paths and add comprehensive MCP security validation

This is a breaking change that fixes import paths in all examples and adds significant new security features.

**Breaking Changes:**
- Fix broken import paths from `../src/guardrails` to `../src/index` in 51 example files
- Import path changes may affect users who were importing from the old paths

**New Features:**
- Add comprehensive security validation tests proving guardrails catch real threats
- Add security effectiveness metrics showing 66.7% recall and 50% precision
- Improve MCP security documentation and examples
- Add new security validation test suite

**Fixes:**
- Fix TypeScript compilation issues and ESLint violations
- Ensure all examples compile and run correctly
- Fix ES module compatibility issues in examples
