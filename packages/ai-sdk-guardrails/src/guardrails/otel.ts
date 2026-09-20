/**
 * Zero-config tracing for each guardrail stage.
 *
 * `@opentelemetry/api` is an optional peer. When it is installed and an SDK is
 * registered (autotel, the official NodeSDK, anything that sets the global
 * tracer provider) every input/output guardrail run becomes a child span of
 * whatever is active, with one `gen_ai.guard.stop` event per blocked result.
 * When the API is missing, or no provider is registered, this is a no-op.
 */

import type { GuardrailResult } from '../types';

type Attrs = Record<string, string | number | boolean>;

/** The slice of `@opentelemetry/api` this module calls, declared locally so the `.d.ts` has no hard dependency on it. */
interface OtelApi {
  trace: {
    getTracer(name: string): {
      startActiveSpan<T>(name: string, fn: (span: Span) => T): T;
    };
  };
  SpanStatusCode: { ERROR: number };
}

interface Span {
  setAttributes(attrs: Attrs): void;
  addEvent(name: string, attrs?: Attrs): void;
  recordException(error: unknown): void;
  setStatus(status: { code: number }): void;
  end(): void;
}

let api: Promise<OtelApi | null> | undefined;

function loadApi(): Promise<OtelApi | null> {
  if (!api) {
    // Non-literal specifier keeps the optional peer out of static resolution.
    const specifier = '@opentelemetry/api';
    api = import(/* @vite-ignore */ specifier)
      .then((m) => m as OtelApi)
      .catch(() => null);
  }
  return api;
}

/** Test seam: inject (or reset with `null`) the resolved API. */
export function __setOtelApi(mod: OtelApi | null): void {
  api = Promise.resolve(mod);
}

export async function traceGuardrails<M extends Record<string, unknown>>(
  stage: 'input' | 'output',
  count: number,
  run: () => Promise<GuardrailResult<M>[]>,
): Promise<GuardrailResult<M>[]> {
  const otel = await loadApi();
  if (!otel) return run();

  return otel.trace
    .getTracer('ai-sdk-guardrails')
    .startActiveSpan(`guardrails.${stage}`, async (span) => {
      span.setAttributes({
        'guardrails.stage': stage,
        'guardrails.count': count,
      });
      try {
        const results = await run();
        const blocked = results.filter((r) => r.tripwireTriggered);
        for (const r of blocked) {
          span.addEvent('gen_ai.guard.stop', {
            'gen_ai.guard.rule':
              r.context?.guardrailName ?? r.info?.guardrailName ?? 'unknown',
            'gen_ai.guard.action': 'block',
            'gen_ai.guard.message': r.message ?? '',
            ...(r.severity && { 'gen_ai.guard.severity': r.severity }),
          });
        }
        span.setAttributes({
          'guardrails.blocked': blocked.length,
          'guardrails.passed': results.length - blocked.length,
        });
        return results;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: otel.SpanStatusCode.ERROR });
        throw error;
      } finally {
        span.end();
      }
    });
}
