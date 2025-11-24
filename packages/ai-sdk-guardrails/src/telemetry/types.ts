/**
 * Telemetry configuration for guardrails.
 *
 * This module provides types for OpenTelemetry integration,
 * allowing users to observe guardrail execution in their
 * distributed tracing systems.
 */

import type { Tracer, AttributeValue } from '@opentelemetry/api';

/**
 * Telemetry configuration for guardrails execution.
 *
 * Guardrails will inherit telemetry settings from the AI SDK's
 * experimental_telemetry option when available, or use these
 * explicit settings.
 *
 * @example
 * ```typescript
 * import { trace } from '@opentelemetry/api';
 *
 * const guardedModel = withGuardrails(model, {
 *   inputGuardrails: [piiDetector()],
 *   executionOptions: {
 *     telemetry: {
 *       isEnabled: true,
 *       tracer: trace.getTracer('my-app'),
 *       recordInputs: true,
 *       recordOutputs: true,
 *     }
 *   }
 * });
 * ```
 */
export interface GuardrailTelemetrySettings {
  /**
   * Enable or disable telemetry for guardrails.
   *
   * When undefined, will inherit from AI SDK's experimental_telemetry.isEnabled
   *
   * @default undefined (inherit from AI SDK)
   */
  isEnabled?: boolean;

  /**
   * Enable or disable input recording in telemetry spans.
   * Includes the actual prompt/messages being validated.
   *
   * You might want to disable input recording to avoid recording sensitive
   * information in your traces.
   *
   * @default true
   */
  recordInputs?: boolean;

  /**
   * Enable or disable output recording in telemetry spans.
   * Includes the actual AI response being validated.
   *
   * You might want to disable output recording to avoid recording sensitive
   * information in your traces.
   *
   * @default true
   */
  recordOutputs?: boolean;

  /**
   * Enable or disable metadata recording in telemetry spans.
   * Includes detailed guardrail execution metadata like blocked content,
   * confidence scores, detected patterns, etc.
   *
   * @default true
   */
  recordMetadata?: boolean;

  /**
   * A custom tracer to use for guardrail telemetry.
   *
   * When undefined, will inherit from AI SDK's experimental_telemetry.tracer
   *
   * @example
   * ```typescript
   * import { trace } from '@opentelemetry/api';
   *
   * const tracer = trace.getTracer('my-app-guardrails', '1.0.0');
   * ```
   */
  tracer?: Tracer;

  /**
   * Additional metadata to include in all guardrail spans.
   * Useful for adding context like environment, user ID, session ID, etc.
   *
   * @example
   * ```typescript
   * {
   *   metadata: {
   *     'app.environment': 'production',
   *     'user.id': '12345',
   *     'session.id': 'abc-def-ghi'
   *   }
   * }
   * ```
   */
  metadata?: Record<string, AttributeValue>;

  /**
   * Function ID to include in telemetry data.
   * Used to group guardrail executions by function/endpoint.
   *
   * When undefined, will inherit from AI SDK's experimental_telemetry.functionId
   */
  functionId?: string;
}
