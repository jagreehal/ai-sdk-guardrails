import type { InputGuardrail, OutputGuardrail, GuardrailResult } from './types';

/**
 * Creates a well-structured input guardrail with enhanced metadata
 * @param guardrail - The guardrail configuration
 * @returns Enhanced input guardrail with automatic metadata injection
 */
export function defineInputGuardrail(
  guardrail: InputGuardrail,
): InputGuardrail {
  const enhanced: InputGuardrail = {
    enabled: true,
    priority: 'medium',
    version: '1.0.0',
    tags: [],
    ...guardrail,
    execute: async (params) => {
      const startTime = Date.now();
      const originalExecute = guardrail.execute;

      try {
        const result = await originalExecute(params);
        const executionTime = Date.now() - startTime;

        return {
          ...result,
          performance: {
            executionTimeMs: executionTime,
            ...result.performance,
          },
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),

            ...result.context,
          },
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;
        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical',
          performance: {
            executionTimeMs: executionTime,
          },
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
          },
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  return enhanced;
}

// ============================================================================
// ENHANCED GUARDRAIL EXECUTION ENGINE WITH BETTER PERFORMANCE AND MONITORING
// ============================================================================

/**
 * Executes input guardrails with enhanced performance monitoring and error handling
 * @param guardrails - Array of input guardrails to execute
 * @param params - Parameters for guardrail execution
 * @param options - Execution options
 * @returns Promise resolving to array of guardrail results
 */
export async function executeInputGuardrails(
  guardrails: InputGuardrail[],
  params: any,
  options: {
    /** Execute guardrails in parallel (default: true) */
    parallel?: boolean;
    /** Maximum execution time in milliseconds */
    timeout?: number;
    /** Whether to continue on first failure */
    continueOnFailure?: boolean;
    /** Logging level */
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  } = {},
): Promise<GuardrailResult[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'info',
  } = options;

  // Filter enabled guardrails and sort by priority
  const enabledGuardrails = guardrails
    .filter((g) => g.enabled !== false)
    .sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (
        (priorityOrder[b.priority || 'medium'] || 2) -
        (priorityOrder[a.priority || 'medium'] || 2)
      );
    });

  const results: GuardrailResult[] = [];

  const executeWithTimeout = async (
    guardrail: InputGuardrail,
  ): Promise<GuardrailResult> => {
    const timeoutPromise = new Promise<GuardrailResult>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Guardrail "${guardrail.name}" timed out after ${timeout}ms`,
            ),
          ),
        timeout,
      );
    });

    const executionPromise = guardrail.execute(params);

    return Promise.race([executionPromise, timeoutPromise]);
  };

  if (parallel) {
    // Execute all guardrails in parallel
    const promises = enabledGuardrails.map(async (guardrail) => {
      try {
        const result = await executeWithTimeout(guardrail);

        if (result.tripwireTriggered && logLevel !== 'none') {
          console.log(
            `Input guardrail "${guardrail.name}" triggered: ${result.message}`,
          );
        }

        return result;
      } catch (error) {
        if (logLevel !== 'none') {
          console.error(
            `Error executing input guardrail "${guardrail.name}":`,
            error,
          );
        }

        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    });

    results.push(...(await Promise.all(promises)));
  } else {
    // Execute guardrails sequentially
    for (const guardrail of enabledGuardrails) {
      try {
        const result = await executeWithTimeout(guardrail);
        results.push(result);

        if (result.tripwireTriggered) {
          if (logLevel !== 'none') {
            console.log(
              `Input guardrail "${guardrail.name}" triggered: ${result.message}`,
            );
          }

          if (!continueOnFailure) {
            break;
          }
        }
      } catch (error) {
        if (logLevel !== 'none') {
          console.error(
            `Error executing input guardrail "${guardrail.name}":`,
            error,
          );
        }

        const errorResult = {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };

        results.push(errorResult);

        if (!continueOnFailure) {
          break;
        }
      }
    }
  }

  return results;
}

// ============================================================================
// ENHANCED GUARDRAIL BUILDERS WITH BETTER DEVELOPER EXPERIENCE
// ============================================================================

/**
 * Creates a well-structured output guardrail with enhanced metadata
 * @param guardrail - The guardrail configuration
 * @returns Enhanced output guardrail with automatic metadata injection
 */
export function defineOutputGuardrail(
  guardrail: OutputGuardrail,
): OutputGuardrail {
  const enhanced: OutputGuardrail = {
    enabled: true,
    priority: 'medium',
    version: '1.0.0',
    tags: [],
    ...guardrail,
    execute: async (params) => {
      const startTime = Date.now();
      const originalExecute = guardrail.execute;

      try {
        const result = await originalExecute(params);
        const executionTime = Date.now() - startTime;

        return {
          ...result,
          performance: {
            executionTimeMs: executionTime,
            ...result.performance,
          },
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),

            ...result.context,
          },
        };
      } catch (error) {
        const executionTime = Date.now() - startTime;
        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical',
          performance: {
            executionTimeMs: executionTime,
          },
          context: {
            guardrailName: guardrail.name,
            guardrailVersion: guardrail.version,
            executedAt: new Date(),
          },
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    },
  };

  return enhanced;
}

// ============================================================================
// ENHANCED GUARDRAIL EXECUTION ENGINE WITH BETTER PERFORMANCE AND MONITORING
// ============================================================================

/**
 * Executes output guardrails with enhanced performance monitoring and error handling
 * @param guardrails - Array of output guardrails to execute
 * @param params - Parameters for guardrail execution
 * @param options - Execution options
 * @returns Promise resolving to array of guardrail results
 */
export async function executeOutputGuardrails(
  guardrails: OutputGuardrail[],
  params: any,
  options: {
    /** Execute guardrails in parallel (default: true) */
    parallel?: boolean;
    /** Maximum execution time in milliseconds */
    timeout?: number;
    /** Whether to continue on first failure */
    continueOnFailure?: boolean;
    /** Logging level */
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
  } = {},
): Promise<GuardrailResult[]> {
  const {
    parallel = true,
    timeout = 30_000, // 30 seconds
    continueOnFailure = true,
    logLevel = 'info',
  } = options;

  // Filter enabled guardrails and sort by priority
  const enabledGuardrails = guardrails
    .filter((g) => g.enabled !== false)
    .sort((a, b) => {
      const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      return (
        (priorityOrder[b.priority || 'medium'] || 2) -
        (priorityOrder[a.priority || 'medium'] || 2)
      );
    });

  const results: GuardrailResult[] = [];

  const executeWithTimeout = async (
    guardrail: OutputGuardrail,
  ): Promise<GuardrailResult> => {
    const timeoutPromise = new Promise<GuardrailResult>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(
              `Guardrail "${guardrail.name}" timed out after ${timeout}ms`,
            ),
          ),
        timeout,
      );
    });

    const executionPromise = guardrail.execute(params);

    return Promise.race([executionPromise, timeoutPromise]);
  };

  if (parallel) {
    // Execute all guardrails in parallel
    const promises = enabledGuardrails.map(async (guardrail) => {
      try {
        const result = await executeWithTimeout(guardrail);

        if (result.tripwireTriggered && logLevel !== 'none') {
          console.log(
            `Output guardrail "${guardrail.name}" triggered: ${result.message}`,
          );
        }

        return result;
      } catch (error) {
        if (logLevel !== 'none') {
          console.error(
            `Error executing output guardrail "${guardrail.name}":`,
            error,
          );
        }

        return {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };
      }
    });

    results.push(...(await Promise.all(promises)));
  } else {
    // Execute guardrails sequentially
    for (const guardrail of enabledGuardrails) {
      try {
        const result = await executeWithTimeout(guardrail);
        results.push(result);

        if (result.tripwireTriggered) {
          if (logLevel !== 'none') {
            console.log(
              `Output guardrail "${guardrail.name}" triggered: ${result.message}`,
            );
          }

          if (!continueOnFailure) {
            break;
          }
        }
      } catch (error) {
        if (logLevel !== 'none') {
          console.error(
            `Error executing output guardrail "${guardrail.name}":`,
            error,
          );
        }

        const errorResult = {
          tripwireTriggered: true,
          message: `Guardrail execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'critical' as const,
          metadata: {
            error: error instanceof Error ? error.message : String(error),
          },
        };

        results.push(errorResult);

        if (!continueOnFailure) {
          break;
        }
      }
    }
  }

  return results;
}
