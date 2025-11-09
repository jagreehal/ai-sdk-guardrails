import type { GuardrailExecutionSummary } from '../types';

/**
 * Options for finish reason mapping
 */
export interface FinishReasonOptions {
  /**
   * Custom finish reason for blocked content
   * @default 'content_filter'
   */
  blocked?:
    | 'content_filter'
    | 'stop'
    | 'length'
    | 'tool_calls'
    | 'error'
    | 'other'
    | 'unknown';

  /**
   * Custom finish reason for successful completion
   * @default 'stop'
   */
  success?:
    | 'content_filter'
    | 'stop'
    | 'length'
    | 'tool_calls'
    | 'error'
    | 'other'
    | 'unknown';
}

/**
 * Determines the appropriate finish reason based on guardrail execution
 *
 * Maps guardrail violations to standard AI SDK finish reasons:
 * - blocked content → 'content_filter' (standard for safety filtering)
 * - successful completion → 'stop'
 *
 * @param summary - Guardrail execution summary
 * @param options - Custom finish reason mapping
 * @returns AI SDK finish reason
 *
 * @example
 * ```typescript
 * const finishReason = getGuardrailFinishReason(summary);
 * // Returns 'content_filter' if blocked, 'stop' otherwise
 * ```
 */
export function getGuardrailFinishReason(
  summary: GuardrailExecutionSummary,
  options?: FinishReasonOptions,
):
  | 'content_filter'
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'error'
  | 'other'
  | 'unknown' {
  const { blocked = 'content_filter', success = 'stop' } = options ?? {};

  if (summary.blockedResults.length > 0) {
    return blocked;
  }

  return success;
}

/**
 * Options for provider metadata creation
 */
export interface ProviderMetadataOptions {
  /**
   * Include full metadata from guardrail results
   * @default false
   */
  includeMetadata?: boolean;

  /**
   * Include execution statistics
   * @default true
   */
  includeStats?: boolean;
}

/**
 * Creates provider metadata object with guardrail information
 *
 * Provider metadata is a standard AI SDK feature that allows attaching
 * custom information to generation results. This function formats
 * guardrail execution details in a structured way for observability.
 *
 * @param summary - Guardrail execution summary
 * @param options - Metadata configuration
 * @returns Provider metadata object
 *
 * @example
 * ```typescript
 * const metadata = createGuardrailProviderMetadata(summary);
 * // Returns:
 * // {
 * //   guardrails: {
 * //     blocked: true,
 * //     violations: [...],
 * //     executionTime: 50,
 * //     guardrailsExecuted: 3,
 * //     stats: { passed: 2, blocked: 1, failed: 0 }
 * //   }
 * // }
 * ```
 */
export function createGuardrailProviderMetadata(
  summary: GuardrailExecutionSummary,
  options?: ProviderMetadataOptions,
): {
  guardrails: {
    blocked: boolean;
    violations: Array<{
      message?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      guardrailName?: string;
      metadata?: unknown;
    }>;
    executionTime: number;
    guardrailsExecuted: number;
    stats?: {
      passed: number;
      blocked: number;
      failed: number;
    };
  };
} {
  const { includeMetadata = false, includeStats = true } = options ?? {};

  const violations = summary.blockedResults.map((result) => {
    const violation: {
      message?: string;
      severity?: 'low' | 'medium' | 'high' | 'critical';
      guardrailName?: string;
      metadata?: unknown;
    } = {
      message: result.message,
      severity: result.severity,
      guardrailName: result.context?.guardrailName,
    };

    if (includeMetadata && result.metadata) {
      violation.metadata = result.metadata;
    }

    return violation;
  });

  return {
    guardrails: {
      blocked: summary.blockedResults.length > 0,
      violations,
      executionTime: summary.totalExecutionTime,
      guardrailsExecuted: summary.guardrailsExecuted,
      ...(includeStats ? { stats: summary.stats } : {}),
    },
  };
}

/**
 * Enhances a generation result with guardrail finish reason and metadata
 *
 * This function modifies the AI SDK result to include:
 * - Appropriate finish reason (content_filter for blocks)
 * - Provider metadata with guardrail execution details
 *
 * @param summary - Guardrail execution summary
 * @param result - Original AI SDK result
 * @param options - Configuration options
 * @returns Enhanced result with guardrail information
 *
 * @example
 * ```typescript
 * const enhanced = createFinishReasonEnhancement(summary, result);
 * console.log(enhanced.finishReason); // 'content_filter'
 * console.log(enhanced.providerMetadata.guardrails.blocked); // true
 * ```
 *
 * @example Use in middleware
 * ```typescript
 * export function createOutputGuardrailsMiddleware(config) {
 *   return {
 *     wrapGenerate: async ({ doGenerate }) => {
 *       const result = await doGenerate();
 *       const summary = await executeOutputGuardrails(...);
 *
 *       if (summary.blockedResults.length > 0) {
 *         return createFinishReasonEnhancement(summary, result);
 *       }
 *
 *       return result;
 *     },
 *   };
 * }
 * ```
 */
export function createFinishReasonEnhancement<
  T extends {
    finishReason:
      | 'content_filter'
      | 'stop'
      | 'length'
      | 'tool_calls'
      | 'error'
      | 'other'
      | 'unknown';
    providerMetadata?: Record<string, unknown>;
  },
>(
  summary: GuardrailExecutionSummary,
  result: T,
  options?: FinishReasonOptions & ProviderMetadataOptions,
): T {
  // If no violations, return original result
  if (summary.blockedResults.length === 0) {
    return result;
  }

  const finishReason = getGuardrailFinishReason(summary, options);
  const guardrailMetadata = createGuardrailProviderMetadata(summary, options);

  return {
    ...result,
    finishReason,
    providerMetadata: result.providerMetadata
      ? { ...result.providerMetadata, ...guardrailMetadata }
      : guardrailMetadata,
  };
}
