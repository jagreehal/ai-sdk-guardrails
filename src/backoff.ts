/**
 * Backoff Helpers for Retry Utilities
 *
 * Composable backoff functions to reduce boilerplate in retry configurations.
 * These are pure functions that return backoff calculators.
 */

export interface BackoffOptions {
  /** Base delay in milliseconds */
  base?: number;
  /** Maximum delay in milliseconds */
  max?: number;
  /** Jitter factor (0-1) to add randomness */
  jitter?: number;
  /** Multiplier for exponential backoff */
  multiplier?: number;
}

/**
 * Exponential backoff with optional jitter and maximum cap
 *
 * @example
 * ```typescript
 * import { retry, exponentialBackoff } from 'ai-sdk-guardrails';
 *
 * await retry({
 *   // ... other options
 *   backoffMs: exponentialBackoff({ base: 1000, max: 10000, jitter: 0.1 })
 * });
 * ```
 */
export function exponentialBackoff(
  options: BackoffOptions = {},
): (attempt: number) => number {
  const { base = 1000, max = 30000, jitter = 0, multiplier = 2 } = options;

  return (attempt: number) => {
    // Calculate exponential delay: base * multiplier^(attempt-1)
    const exponentialDelay = base * Math.pow(multiplier, attempt - 1);

    // Apply maximum cap
    const cappedDelay = Math.min(exponentialDelay, max);

    // Apply jitter if specified
    if (jitter > 0) {
      const jitterAmount = cappedDelay * jitter * Math.random();
      return Math.round(
        cappedDelay + jitterAmount - (cappedDelay * jitter) / 2,
      );
    }

    return cappedDelay;
  };
}

/**
 * Linear backoff with optional jitter
 *
 * @example
 * ```typescript
 * import { retry, linearBackoff } from 'ai-sdk-guardrails';
 *
 * await retry({
 *   // ... other options
 *   backoffMs: linearBackoff({ base: 1000, max: 5000 })
 * });
 * ```
 */
export function linearBackoff(
  options: BackoffOptions = {},
): (attempt: number) => number {
  const { base = 1000, max = 30000, jitter = 0 } = options;

  return (attempt: number) => {
    // Linear increase: base * attempt
    const linearDelay = base * attempt;

    // Apply maximum cap
    const cappedDelay = Math.min(linearDelay, max);

    // Apply jitter if specified
    if (jitter > 0) {
      const jitterAmount = cappedDelay * jitter * Math.random();
      return Math.round(
        cappedDelay + jitterAmount - (cappedDelay * jitter) / 2,
      );
    }

    return cappedDelay;
  };
}

/**
 * Fixed delay with optional jitter
 *
 * @example
 * ```typescript
 * import { retry, fixedBackoff } from 'ai-sdk-guardrails';
 *
 * await retry({
 *   // ... other options
 *   backoffMs: fixedBackoff({ base: 2000, jitter: 0.2 })
 * });
 * ```
 */
export function fixedBackoff(
  options: BackoffOptions = {},
): (attempt: number) => number {
  const { base = 1000, jitter = 0 } = options;

  return (_attempt: number) => {
    // Apply jitter if specified
    if (jitter > 0) {
      const jitterAmount = base * jitter * Math.random();
      return Math.round(base + jitterAmount - (base * jitter) / 2);
    }

    return base;
  };
}

/**
 * No delay backoff (immediate retry)
 *
 * @example
 * ```typescript
 * import { retry, noBackoff } from 'ai-sdk-guardrails';
 *
 * await retry({
 *   // ... other options
 *   backoffMs: noBackoff()
 * });
 * ```
 */
export function noBackoff(): (attempt: number) => number {
  return (_attempt: number) => 0;
}

/**
 * Composite backoff that switches strategies based on attempt number
 *
 * @example
 * ```typescript
 * import { retry, compositeBackoff, fixedBackoff, exponentialBackoff } from 'ai-sdk-guardrails';
 *
 * await retry({
 *   // ... other options
 *   backoffMs: compositeBackoff([
 *     { maxAttempts: 2, backoff: fixedBackoff({ base: 1000 }) },
 *     { maxAttempts: Infinity, backoff: exponentialBackoff({ base: 2000, max: 10000 }) }
 *   ])
 * });
 * ```
 */
export function compositeBackoff(
  strategies: Array<{
    maxAttempts: number;
    backoff: (attempt: number) => number;
  }>,
): (attempt: number) => number {
  return (attempt: number) => {
    for (const strategy of strategies) {
      if (attempt <= strategy.maxAttempts) {
        return strategy.backoff(attempt);
      }
    }

    // Fallback to last strategy
    const lastStrategy = strategies[strategies.length - 1];
    return lastStrategy ? lastStrategy.backoff(attempt) : 0;
  };
}

/**
 * Jittered exponential backoff (common pattern)
 * Equivalent to exponentialBackoff with 10% jitter
 */
export const jitteredExponentialBackoff = (
  options: Omit<BackoffOptions, 'jitter'> = {},
) => exponentialBackoff({ ...options, jitter: 0.1 });

/**
 * Common presets for quick setup
 */
export const presets = {
  /** Fast retry: 500ms, 1s, 2s, 4s (max 4s) */
  fast: () => exponentialBackoff({ base: 500, max: 4000 }),

  /** Standard retry: 1s, 2s, 4s, 8s, 16s (max 16s) */
  standard: () => exponentialBackoff({ base: 1000, max: 16000 }),

  /** Slow retry: 2s, 4s, 8s, 16s, 32s (max 32s) */
  slow: () => exponentialBackoff({ base: 2000, max: 32000 }),

  /** Network resilient: jittered exponential with longer delays */
  networkResilient: () =>
    jitteredExponentialBackoff({ base: 1000, max: 30000 }),

  /** Aggressive: very fast with short max delay for quick failures */
  aggressive: () => exponentialBackoff({ base: 200, max: 2000 }),
} as const;
