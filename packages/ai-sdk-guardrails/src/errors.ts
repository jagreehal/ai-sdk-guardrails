/**
 * Base class for all guardrails-related errors.
 * Provides a foundation for the hierarchical error system.
 */
export abstract class GuardrailsError extends Error {
  abstract override readonly name: string;
  abstract readonly code: string;

  public readonly timestamp: Date;
  public readonly metadata: Record<string, unknown>;

  constructor(message: string, metadata: Record<string, unknown> = {}) {
    super(message);
    this.timestamp = new Date();
    this.metadata = metadata;

    // Ensure the name is set correctly for stack traces
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * Convert the error to a serializable object for logging/reporting
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp.toISOString(),
      metadata: this.metadata,
      stack: this.stack,
    };
  }

  /**
   * Check if this error is of a specific type
   */
  is<T extends GuardrailsError>(
    errorClass: new (...args: any[]) => T,
  ): this is T {
    return this instanceof errorClass;
  }
}

/**
 * Thrown when guardrail validation fails
 */
export class GuardrailValidationError extends GuardrailsError {
  override readonly name = 'GuardrailValidationError';
  readonly code = 'GUARDRAIL_VALIDATION_FAILED';

  public readonly guardrailName: string;
  public readonly validationErrors: ValidationError[];

  constructor(
    guardrailName: string,
    validationErrors: ValidationError[],
    metadata: Record<string, unknown> = {},
  ) {
    const message = `Guardrail "${guardrailName}" validation failed: ${validationErrors.map((e) => e.message).join(', ')}`;
    super(message, { ...metadata, guardrailName, validationErrors });

    this.guardrailName = guardrailName;
    this.validationErrors = validationErrors;
  }
}

/**
 * Thrown when guardrail execution encounters an error
 */
export class GuardrailExecutionError extends GuardrailsError {
  override readonly name = 'GuardrailExecutionError';
  readonly code = 'GUARDRAIL_EXECUTION_FAILED';

  public readonly guardrailName: string;
  public readonly originalError?: Error;

  constructor(
    guardrailName: string,
    originalError?: Error,
    metadata: Record<string, unknown> = {},
  ) {
    const message = originalError
      ? `Guardrail "${guardrailName}" execution failed: ${originalError.message}`
      : `Guardrail "${guardrailName}" execution failed`;

    super(message, {
      ...metadata,
      guardrailName,
      originalError: originalError?.message,
    });

    this.guardrailName = guardrailName;
    this.originalError = originalError;
  }
}

/**
 * Thrown when a guardrail times out during execution
 */
export class GuardrailTimeoutError extends GuardrailsError {
  override readonly name = 'GuardrailTimeoutError';
  readonly code = 'GUARDRAIL_TIMEOUT';

  public readonly guardrailName: string;
  public readonly timeoutMs: number;

  constructor(
    guardrailName: string,
    timeoutMs: number,
    metadata: Record<string, unknown> = {},
  ) {
    const message = `Guardrail "${guardrailName}" timed out after ${timeoutMs}ms`;
    super(message, { ...metadata, guardrailName, timeoutMs });

    this.guardrailName = guardrailName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when guardrail configuration is invalid
 */
export class GuardrailConfigurationError extends GuardrailsError {
  override readonly name = 'GuardrailConfigurationError';
  readonly code = 'GUARDRAIL_CONFIG_INVALID';

  public readonly configPath?: string;
  public readonly configErrors: string[];

  constructor(
    configErrors: string[],
    configPath?: string,
    metadata: Record<string, unknown> = {},
  ) {
    const message = `Guardrail configuration error${configPath ? ` in ${configPath}` : ''}: ${configErrors.join(', ')}`;
    super(message, { ...metadata, configPath, configErrors });

    this.configPath = configPath;
    this.configErrors = configErrors;
  }
}

/**
 * Thrown when input to guardrails is blocked/rejected
 */
export class GuardrailsInputError extends GuardrailsError {
  override readonly name = 'GuardrailsInputError';
  readonly code = 'INPUT_BLOCKED';

  public readonly blockedGuardrails: Array<{
    name: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;

  constructor(
    blockedGuardrails: GuardrailsInputError['blockedGuardrails'],
    metadata: Record<string, unknown> = {},
  ) {
    const guardrailNames = blockedGuardrails.map((g) => g.name).join(', ');
    const message = `Input blocked by guardrail${blockedGuardrails.length > 1 ? 's' : ''}: ${guardrailNames}`;
    super(message, { ...metadata, blockedGuardrails });

    this.blockedGuardrails = blockedGuardrails;
  }
}

/**
 * Thrown when output from AI model is blocked/rejected
 */
export class GuardrailsOutputError extends GuardrailsError {
  override readonly name = 'GuardrailsOutputError';
  readonly code = 'OUTPUT_BLOCKED';

  public readonly blockedGuardrails: Array<{
    name: string;
    message: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;

  constructor(
    blockedGuardrails: GuardrailsOutputError['blockedGuardrails'],
    metadata: Record<string, unknown> = {},
  ) {
    const guardrailNames = blockedGuardrails.map((g) => g.name).join(', ');
    const message = `Output blocked by guardrail${blockedGuardrails.length > 1 ? 's' : ''}: ${guardrailNames}`;
    super(message, { ...metadata, blockedGuardrails });

    this.blockedGuardrails = blockedGuardrails;
  }
}

/**
 * Thrown when middleware encounters an error
 */
export class MiddlewareError extends GuardrailsError {
  override readonly name = 'MiddlewareError';
  readonly code = 'MIDDLEWARE_ERROR';

  public readonly middlewareType: 'input' | 'output';
  public readonly phase: 'transform' | 'wrap' | 'execute';
  public readonly originalError?: Error;

  constructor(
    middlewareType: 'input' | 'output',
    phase: 'transform' | 'wrap' | 'execute',
    originalError?: Error,
    metadata: Record<string, unknown> = {},
  ) {
    const message = originalError
      ? `${middlewareType} middleware ${phase} error: ${originalError.message}`
      : `${middlewareType} middleware ${phase} error`;

    super(message, {
      ...metadata,
      middlewareType,
      phase,
      originalError: originalError?.message,
    });

    this.middlewareType = middlewareType;
    this.phase = phase;
    this.originalError = originalError;
  }
}

/**
 * Individual validation error within a guardrail
 */
export interface ValidationError {
  field?: string;
  message: string;
  code?: string;
  value?: unknown;
}

/**
 * Utility function to check if an error is a guardrails error
 */
export function isGuardrailsError(error: unknown): error is GuardrailsError {
  return error instanceof GuardrailsError;
}

/**
 * Utility function to extract error information for logging
 */
export function extractErrorInfo(error: unknown): {
  name: string;
  message: string;
  code?: string;
  metadata?: Record<string, unknown>;
} {
  if (isGuardrailsError(error)) {
    return {
      name: error.name,
      message: error.message,
      code: error.code,
      metadata: error.metadata,
    };
  }

  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: 'UnknownError',
    message: String(error),
  };
}
