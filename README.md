# AI SDK Guardrails

A monorepo for AI SDK Guardrails - input and output safety controls for the [Vercel AI SDK](https://ai-sdk.dev).

[![npm version](https://img.shields.io/npm/v/ai-sdk-guardrails.svg?logo=npm&label=npm)](https://www.npmjs.com/package/ai-sdk-guardrails)
[![downloads](https://img.shields.io/npm/dw/ai-sdk-guardrails.svg?label=downloads)](https://www.npmjs.com/package/ai-sdk-guardrails)
[![bundle size](https://img.shields.io/bundlephobia/minzip/ai-sdk-guardrails.svg?label=minzipped)](https://bundlephobia.com/package/ai-sdk-guardrails)
[![license](https://img.shields.io/npm/l/ai-sdk-guardrails.svg?label=license)](./LICENSE)
![types](https://img.shields.io/badge/TypeScript-Ready-3178C6?logo=typescript&logoColor=white)

📚 **[Documentation](https://jagreehal.github.io/ai-sdk-guardrails/)** | 📦 **[npm Package](https://www.npmjs.com/package/ai-sdk-guardrails)** | 🛡️ **[Package README](./packages/ai-sdk-guardrails/README.md)**

## Quick Start

```bash
npm install ai-sdk-guardrails
```

```ts
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { withGuardrails, piiDetector, promptInjectionDetector } from 'ai-sdk-guardrails';

const model = withGuardrails(openai('gpt-4o'), {
  inputGuardrails: [piiDetector(), promptInjectionDetector()],
});

const { text } = await generateText({
  model,
  prompt: 'Write a friendly email',
});
```

See the **[full documentation](https://jagreehal.github.io/ai-sdk-guardrails/)** and **[package README](./packages/ai-sdk-guardrails/README.md)** for detailed usage.

## Repository Structure

This is a pnpm monorepo containing:

```
ai-sdk-guardrails/
├── packages/
│   ├── ai-sdk-guardrails/    # Main library package (published to npm)
│   └── examples/              # 60+ usage examples
├── docs/                      # Documentation site (GitHub Pages)
└── wizard-prototype/          # Interactive guardrail configuration wizard
```

### Packages

- **[ai-sdk-guardrails](./packages/ai-sdk-guardrails/)** - The core library providing guardrails middleware for the Vercel AI SDK
- **[examples](./packages/examples/)** - Comprehensive examples covering all guardrail features and patterns

### Documentation

- **[Website](https://jagreehal.github.io/ai-sdk-guardrails/)** - Full documentation and guides
- **[docs/](./docs/)** - Documentation source files

## Development

### Prerequisites

- Node.js 22+
- pnpm 9+

### Getting Started

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm type-check
```

### Working with Packages

```bash
# Build specific package
pnpm --filter ai-sdk-guardrails build

# Run example
pnpm --filter @ai-sdk-guardrails/examples dev examples/01-input-length-limit.ts

# Test specific package
pnpm --filter ai-sdk-guardrails test
```

### Project Commands

```bash
pnpm build          # Build all packages
pnpm test           # Run all tests
pnpm type-check     # Type check all packages
pnpm lint           # Lint all packages
pnpm format         # Format code
```

## Contributing

Contributions are welcome! To contribute:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests and type checking (`pnpm test && pnpm type-check`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

### Development Guidelines

- Follow the existing code style (use `pnpm format`)
- Add tests for new features
- Update documentation as needed
- Ensure all tests pass before submitting PR

## Publishing

The `ai-sdk-guardrails` package is published to npm. Publishing is handled through changesets:

```bash
# Add changeset for your changes
pnpm changeset

# Version packages (updates package.json and CHANGELOG)
pnpm changeset version

# Publish to npm
pnpm changeset publish
```

## License

MIT © [Jag Reehal](https://jagreehal.com)

## Links

- **[Documentation](https://jagreehal.github.io/ai-sdk-guardrails/)**
- **[npm Package](https://www.npmjs.com/package/ai-sdk-guardrails)**
- **[GitHub](https://github.com/jagreehal/ai-sdk-guardrails)**
- **[Issues](https://github.com/jagreehal/ai-sdk-guardrails/issues)**
