# Contributing to AI SDK Guardrails

Thank you for your interest in contributing to AI SDK Guardrails! We welcome contributions from the community.

## Getting Started

### Prerequisites

- Node.js 22+
- pnpm 9+

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/ai-sdk-guardrails.git
   cd ai-sdk-guardrails
   ```

3. Install dependencies:
   ```bash
   pnpm install
   ```

4. Build all packages:
   ```bash
   pnpm build
   ```

## Development Workflow

### Making Changes

1. Create a new branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes in the appropriate package:
   - Core library: `packages/ai-sdk-guardrails/`
   - Examples: `packages/examples/`
   - Documentation: `docs/`

3. Run tests:
   ```bash
   pnpm test
   ```

4. Run type checking:
   ```bash
   pnpm type-check
   ```

5. Format your code:
   ```bash
   pnpm format
   ```

### Working with Specific Packages

```bash
# Build specific package
pnpm --filter ai-sdk-guardrails build

# Test specific package
pnpm --filter ai-sdk-guardrails test

# Run an example
pnpm --filter @ai-sdk-guardrails/examples dev examples/01-input-length-limit.ts
```

## Contribution Guidelines

### Code Style

- Follow the existing code style
- Use `pnpm format` to format your code
- Run `pnpm lint` to check for linting issues
- Ensure TypeScript types are properly defined

### Testing

- Add tests for new features
- Ensure all existing tests pass
- Aim for good test coverage
- Test both success and error cases

### Documentation

- Update README.md if adding new features
- Add JSDoc comments for public APIs
- Include examples for new guardrails
- Update the documentation site if needed

### Commit Messages

- Use clear, descriptive commit messages
- Follow conventional commit format (optional but recommended):
  - `feat:` for new features
  - `fix:` for bug fixes
  - `docs:` for documentation changes
  - `test:` for test changes
  - `refactor:` for refactoring
  - `chore:` for maintenance tasks

### Pull Requests

1. Push your changes to your fork
2. Create a pull request to the main repository
3. Fill out the PR template with:
   - Description of changes
   - Related issues (if any)
   - Testing performed
   - Breaking changes (if any)

4. Wait for review and address any feedback

## Adding New Guardrails

When adding a new guardrail:

1. Create the guardrail in the appropriate file:
   - Input guardrails: `packages/ai-sdk-guardrails/src/guardrails/input.ts`
   - Output guardrails: `packages/ai-sdk-guardrails/src/guardrails/output.ts`
   - Tool guardrails: `packages/ai-sdk-guardrails/src/guardrails/tools.ts`

2. Add tests in the corresponding `.test.ts` file

3. Export the guardrail from `packages/ai-sdk-guardrails/src/index.ts`

4. Add an example in `packages/examples/`

5. Update the package README to list the new guardrail

## Changesets

We use changesets for version management. When making changes that affect the published package:

1. Add a changeset:
   ```bash
   pnpm changeset
   ```

2. Select the package(s) affected
3. Choose the version bump type (major, minor, patch)
4. Describe your changes

The changeset will be included in your PR.

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Focus on the code, not the person
- Help create a welcoming community

## Questions?

If you have questions:

- Open an issue for bugs or feature requests
- Check existing issues and discussions
- Reach out to the maintainers

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

Thank you for contributing to AI SDK Guardrails!
