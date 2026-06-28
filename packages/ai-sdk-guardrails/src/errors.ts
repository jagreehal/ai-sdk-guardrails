import { AISDKError } from '@ai-sdk/provider';

// Marker symbol for cross-version `instanceof`-free detection, mirroring the AI
// SDK's own error convention (see `AISDKError`). Any GuardrailsError is also an
// AISDKError, so `AISDKError.isInstance(err)` catches guardrail errors too.
const marker = 'ai-sdk-guardrails.error';
const symbol = Symbol.for(marker);

/**
 * Base class for all guardrails-related errors. Extends the AI SDK's
 * {@link AISDKError} so guardrail failures sit in the same error hierarchy as the
 * rest of the SDK and are catchable via `AISDKError.isInstance(err)`.
 */
export abstract class GuardrailsError extends AISDKError {
  private readonly [symbol] = true; // used in isInstance

  abstract readonly code: string;

  public readonly timestamp: Date;
  public readonly metadata: Record<string, unknown>;

  constructor(
    name: string,
    message: string,
    metadata: Record<string, unknown> = {},
    cause?: unknown,
  ) {
    super({ name, message, cause });
    this.timestamp = new Date();
    this.metadata = metadata;
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
   * Check if this error is of a specific guardrails error subclass.
   */
  is<T extends GuardrailsError>(
    errorClass: new (...args: any[]) => T,
  ): this is T {
    return this instanceof errorClass;
  }

  /**
   * Checks whether the given value is a guardrails error, across package
   * versions (marker-based, like `AISDKError.isInstance`).
   */
  static override isInstance(error: unknown): error is GuardrailsError {
    return AISDKError.hasMarker(error, marker);
  }
}

/**
 * Thrown when guardrail validation fails
 */
export class GuardrailValidationError extends GuardrailsError {
  readonly code = 'GUARDRAIL_VALIDATION_FAILED';

  public readonly guardrailName: string;
  public readonly validationErrors: ValidationError[];

  constructor(
    guardrailName: string,
    validationErrors: ValidationError[],
    metadata: Record<string, unknown> = {},
  ) {
    const message = `Guardrail "${guardrailName}" validation failed: ${validationErrors.map((e) => e.message).join(', ')}`;
    super('GuardrailValidationError', message, {
      ...metadata,
      guardrailName,
      validationErrors,
    });

    this.guardrailName = guardrailName;
    this.validationErrors = validationErrors;
  }
}

/**
 * Thrown when guardrail execution encounters an error
 */
export class GuardrailExecutionError extends GuardrailsError {
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

    super(
      'GuardrailExecutionError',
      message,
      { ...metadata, guardrailName, originalError: originalError?.message },
      originalError,
    );

    this.guardrailName = guardrailName;
    this.originalError = originalError;
  }
}

/**
 * Thrown when a guardrail times out during execution
 */
export class GuardrailTimeoutError extends GuardrailsError {
  readonly code = 'GUARDRAIL_TIMEOUT';

  public readonly guardrailName: string;
  public readonly timeoutMs: number;

  constructor(
    guardrailName: string,
    timeoutMs: number,
    metadata: Record<string, unknown> = {},
  ) {
    const message = `Guardrail "${guardrailName}" timed out after ${timeoutMs}ms`;
    super('GuardrailTimeoutError', message, {
      ...metadata,
      guardrailName,
      timeoutMs,
    });

    this.guardrailName = guardrailName;
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Thrown when guardrail configuration is invalid
 */
export class GuardrailConfigurationError extends GuardrailsError {
  readonly code = 'GUARDRAIL_CONFIG_INVALID';

  public readonly configPath?: string;
  public readonly configErrors: string[];

  constructor(
    configErrors: string[],
    configPath?: string,
    metadata: Record<string, unknown> = {},
  ) {
    const message = `Guardrail configuration error${configPath ? ` in ${configPath}` : ''}: ${configErrors.join(', ')}`;
    super('GuardrailConfigurationError', message, {
      ...metadata,
      configPath,
      configErrors,
    });

    this.configPath = configPath;
    this.configErrors = configErrors;
  }
}

/**
 * Thrown when input to guardrails is blocked/rejected
 */
export class GuardrailsInputError extends GuardrailsError {
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
    super('GuardrailsInputError', message, { ...metadata, blockedGuardrails });

    this.blockedGuardrails = blockedGuardrails;
  }
}

/**
 * Thrown when output from AI model is blocked/rejected
 */
export class GuardrailsOutputError extends GuardrailsError {
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
    super('GuardrailsOutputError', message, { ...metadata, blockedGuardrails });

    this.blockedGuardrails = blockedGuardrails;
  }
}

/**
 * Thrown when middleware encounters an error
 */
export class MiddlewareError extends GuardrailsError {
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

    super(
      'MiddlewareError',
      message,
      {
        ...metadata,
        middlewareType,
        phase,
        originalError: originalError?.message,
      },
      originalError,
    );

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
 * Utility function to check if an error is a guardrails error.
 * Equivalent to {@link GuardrailsError.isInstance}.
 */
export function isGuardrailsError(error: unknown): error is GuardrailsError {
  return GuardrailsError.isInstance(error);
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
