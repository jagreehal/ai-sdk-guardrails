/**
 * Telemetry utilities for guardrails.
 *
 * This module provides functions for OpenTelemetry integration.
 *
 * NOTE: To use telemetry features, you must install @opentelemetry/api as a peer dependency:
 *   npm install @opentelemetry/api
 *
 * If telemetry is not enabled (isEnabled: false), this module has zero overhead.
 */

import type { GuardrailTelemetrySettings } from './types';
import type { GuardrailResult } from '../types';
import type {
  Tracer,
  Span,
  Attributes,
  AttributeValue,
} from '@opentelemetry/api';

/**
 * Lazy-loaded OpenTelemetry API.
 * Only imported when telemetry is actually used.
 */
let otelAPI: typeof import('@opentelemetry/api') | undefined;
let otelLoadError: Error | undefined;

/**
 * Get the OpenTelemetry API, loading it if not already loaded.
 * Returns undefined if @opentelemetry/api is not installed.
 */
function getOTelAPI(): typeof import('@opentelemetry/api') | undefined {
  if (otelAPI) {
    return otelAPI;
  }

  if (otelLoadError) {
    return undefined;
  }

  try {
    // Dynamic require for lazy loading
    // This works in both ESM and CJS builds
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    otelAPI = require('@opentelemetry/api');
    return otelAPI;
  } catch (error) {
    otelLoadError = error as Error;
    return undefined;
  }
}

/**
 * No-op span context for when OpenTelemetry is not available.
 * Matches AI SDK's implementation.
 */
const noopSpanContext = {
  traceId: '',
  spanId: '',
  traceFlags: 0,
};

/**
 * No-op span for when OpenTelemetry is not available.
 * Matches AI SDK's implementation - returns `this` for proper chaining.
 */
const noopSpan: Span = {
  spanContext() {
    return noopSpanContext;
  },
  setAttribute() {
    return this;
  },
  setAttributes() {
    return this;
  },
  addEvent() {
    return this;
  },
  addLink() {
    return this;
  },
  addLinks() {
    return this;
  },
  setStatus() {
    return this;
  },
  updateName() {
    return this;
  },
  end() {
    return this;
  },
  isRecording() {
    return false;
  },
  recordException() {
    return this;
  },
};

/**
 * No-op tracer for when OpenTelemetry is not available.
 * Matches AI SDK's implementation - handles all startActiveSpan overloads.
 */
const noopTracer: Tracer = {
  startSpan(): Span {
    return noopSpan;
  },

  // Matches AI SDK's noop-tracer.ts implementation - any is required for overload handling
  startActiveSpan<F extends (span: Span) => unknown>(
    name: unknown,
    arg1: unknown,
    arg2?: unknown,
    arg3?: F,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): ReturnType<any> {
    if (typeof arg1 === 'function') {
      return arg1(noopSpan);
    }
    if (typeof arg2 === 'function') {
      return arg2(noopSpan);
    }
    if (typeof arg3 === 'function') {
      return arg3(noopSpan);
    }
  },
};

/**
 * Get a tracer for guardrails telemetry.
 *
 * Priority order:
 * 1. Custom tracer from settings
 * 2. Global tracer from OpenTelemetry API
 * 3. No-op tracer if OTel is not available
 *
 * @param settings Telemetry settings
 * @returns Tracer instance
 */
export function getGuardrailTracer(
  settings?: GuardrailTelemetrySettings,
): Tracer {
  // Use custom tracer if provided
  if (settings?.tracer) {
    return settings.tracer;
  }

  // Try to get global tracer from OpenTelemetry
  const otel = getOTelAPI();
  if (otel) {
    return otel.trace.getTracer('ai-sdk-guardrails', '5.0.0');
  }

  // Fall back to no-op tracer
  return noopTracer;
}

/**
 * Merge AI SDK telemetry settings with guardrail-specific settings.
 * Guardrail settings take precedence over AI SDK settings.
 *
 * @param aiSdkTelemetry Telemetry from AI SDK's experimental_telemetry
 * @param guardrailTelemetry Guardrail-specific telemetry settings
 * @returns Merged telemetry settings
 */
export function mergeTelemetrySettings(
  aiSdkTelemetry?: {
    isEnabled?: boolean;
    recordInputs?: boolean;
    recordOutputs?: boolean;
    functionId?: string;
    metadata?: Record<string, unknown>;
    tracer?: Tracer;
  },
  guardrailTelemetry?: GuardrailTelemetrySettings,
): GuardrailTelemetrySettings | undefined {
  // If guardrail telemetry is explicitly provided, use it (with AI SDK as fallback)
  if (guardrailTelemetry) {
    return {
      // Inherit from AI SDK if not explicitly set in guardrail settings
      isEnabled:
        guardrailTelemetry.isEnabled === undefined
          ? aiSdkTelemetry?.isEnabled
          : guardrailTelemetry.isEnabled,
      recordInputs:
        guardrailTelemetry.recordInputs === undefined
          ? aiSdkTelemetry?.recordInputs
          : guardrailTelemetry.recordInputs,
      recordOutputs:
        guardrailTelemetry.recordOutputs === undefined
          ? aiSdkTelemetry?.recordOutputs
          : guardrailTelemetry.recordOutputs,
      functionId:
        guardrailTelemetry.functionId === undefined
          ? aiSdkTelemetry?.functionId
          : guardrailTelemetry.functionId,
      tracer:
        guardrailTelemetry.tracer === undefined
          ? aiSdkTelemetry?.tracer
          : guardrailTelemetry.tracer,
      // Merge metadata (guardrail metadata takes precedence)
      metadata: (() => {
        const merged: Record<string, Attributes[string]> = {};
        if (aiSdkTelemetry?.metadata) {
          for (const [key, value] of Object.entries(aiSdkTelemetry.metadata)) {
            if (value !== undefined) {
              merged[key] = value as Attributes[string];
            }
          }
        }
        if (guardrailTelemetry.metadata) {
          for (const [key, value] of Object.entries(
            guardrailTelemetry.metadata,
          )) {
            if (value !== undefined) {
              merged[key] = value as Attributes[string];
            }
          }
        }
        return Object.keys(merged).length > 0
          ? (merged as Record<string, AttributeValue>)
          : undefined;
      })(),
      // Guardrail-specific settings (no inheritance from AI SDK)
      recordMetadata: guardrailTelemetry.recordMetadata,
    };
  }

  // If only AI SDK telemetry is provided, convert it to guardrail format
  if (aiSdkTelemetry) {
    return {
      isEnabled: aiSdkTelemetry.isEnabled,
      recordInputs: aiSdkTelemetry.recordInputs,
      recordOutputs: aiSdkTelemetry.recordOutputs,
      functionId: aiSdkTelemetry.functionId,
      tracer: aiSdkTelemetry.tracer,
      metadata: aiSdkTelemetry.metadata
        ? (aiSdkTelemetry.metadata as Record<string, AttributeValue>)
        : undefined,
      // Default to true for guardrail-specific settings
      recordMetadata: true,
    };
  }

  // No telemetry settings
  return undefined;
}

/**
 * Check if telemetry is enabled based on settings.
 *
 * @param settings Telemetry settings
 * @returns true if telemetry should be recorded
 */
export function isTelemetryEnabled(
  settings?: GuardrailTelemetrySettings,
): boolean {
  // Explicitly disabled
  if (settings?.isEnabled === false) {
    return false;
  }

  // Explicitly enabled
  if (settings?.isEnabled === true) {
    return true;
  }

  // Default to disabled when no settings provided
  return false;
}

/**
 * Record an error on a span.
 * Matches AI SDK's implementation.
 *
 * If the error is an instance of Error, an exception event will be recorded on the span,
 * otherwise the span will be set to an error status.
 *
 * @param span The span to record the error on
 * @param error The error to record on the span
 */
export function recordErrorOnSpan(span: Span, error: unknown) {
  const otel = getOTelAPI();
  if (!otel) {
    return;
  }

  if (error instanceof Error) {
    span.recordException({
      name: error.name,
      message: error.message,
      stack: error.stack,
    });
    span.setStatus({
      code: otel.SpanStatusCode.ERROR,
      message: error.message,
    });
  } else {
    span.setStatus({ code: otel.SpanStatusCode.ERROR });
  }
}

/**
 * Record a guardrail execution as a span.
 * Based on AI SDK's recordSpan implementation.
 *
 * @param name Span name
 * @param tracer OpenTelemetry tracer
 * @param attributes Span attributes
 * @param fn Function to execute within the span
 * @returns Promise resolving to the function result
 */
export async function recordGuardrailSpan<T>({
  name,
  tracer,
  attributes,
  fn,
}: {
  name: string;
  tracer: Tracer;
  attributes: Attributes;
  fn: (span: Span) => Promise<T>;
}): Promise<T> {
  const otel = getOTelAPI();
  if (!otel) {
    // OTel not available, just execute the function
    return fn(noopSpan);
  }

  return tracer.startActiveSpan(name, { attributes }, async (span) => {
    try {
      const result = await fn(span);
      span.end();
      return result;
    } catch (error) {
      try {
        recordErrorOnSpan(span, error);
      } finally {
        // Always stop the span when there is an error
        span.end();
      }
      throw error;
    }
  });
}

/**
 * Add guardrail result attributes to a span.
 *
 * @param span OpenTelemetry span
 * @param result Guardrail result
 * @param settings Telemetry settings
 */
export function addGuardrailResultAttributes(
  span: Span,
  result: GuardrailResult,
  settings?: GuardrailTelemetrySettings,
): void {
  // Always record basic result info
  span.setAttribute('guardrail.triggered', result.tripwireTriggered);

  if (result.severity) {
    span.setAttribute('guardrail.severity', result.severity);
  }

  if (result.message) {
    span.setAttribute('guardrail.message', result.message);
  }

  if (result.context?.executionTimeMs) {
    span.setAttribute(
      'guardrail.execution_time_ms',
      result.context.executionTimeMs,
    );
  }

  // Record metadata if enabled
  const recordMetadata = settings?.recordMetadata !== false;
  if (recordMetadata && result.metadata) {
    // Flatten metadata for span attributes
    for (const [key, value] of Object.entries(result.metadata)) {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
      ) {
        span.setAttribute(`guardrail.metadata.${key}`, value);
      } else if (Array.isArray(value)) {
        span.setAttribute(`guardrail.metadata.${key}`, JSON.stringify(value));
      } else if (value && typeof value === 'object') {
        span.setAttribute(`guardrail.metadata.${key}`, JSON.stringify(value));
      }
    }
  }
}

/**
 * Add guardrail configuration attributes to a span.
 *
 * @param span OpenTelemetry span
 * @param name Guardrail name
 * @param version Guardrail version
 * @param priority Guardrail priority
 * @param tags Guardrail tags
 */
export function addGuardrailConfigAttributes(
  span: Span,
  name: string,
  version?: string,
  priority?: string,
  tags?: string[],
): void {
  span.setAttribute('guardrail.name', name);

  if (version) {
    span.setAttribute('guardrail.version', version);
  }

  if (priority) {
    span.setAttribute('guardrail.priority', priority);
  }

  if (tags && tags.length > 0) {
    span.setAttribute('guardrail.tags', tags.join(','));
  }
}
