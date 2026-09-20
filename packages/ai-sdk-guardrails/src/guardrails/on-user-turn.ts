import type { InputGuardrail, InputGuardrailContext } from '../types';
import { toNormalizedGuardrailContext } from './internal';

/**
 * Run an input guardrail only on a user turn (the newest message in the
 * request is the user's) and skip it on the tool-loop steps that follow.
 *
 * Input guardrails are model middleware, so in a `ToolLoopAgent` they run on
 * every step: once for the user's message, then again for each step whose
 * newest message is a tool result. `promptInjectionDetector` wants that, since
 * tool output can carry an injection too. A guardrail that costs money or only
 * applies to what the user said (an LLM-judged scope check, a rate limit, a
 * per-message length rule) should run once per user message. Wrap those:
 *
 * ```ts
 * agentGuardrails({
 *   model,
 *   inputGuardrails: [
 *     promptInjectionDetector(),          // every step: scans tool results too
 *     onUserTurn(topicGuardrail),         // once per user message
 *   ],
 * });
 * ```
 *
 * Decided from the request alone, with no shared step counter, so it is safe
 * under concurrent calls to the same agent.
 */
export function onUserTurn<M extends Record<string, unknown>>(
  guardrail: InputGuardrail<M>,
): InputGuardrail<M> {
  return {
    ...guardrail,
    execute: async (
      context: InputGuardrailContext,
      options?: { signal?: AbortSignal },
    ) => {
      const { messages } = toNormalizedGuardrailContext(context);
      const newest = messages.at(-1);
      // A bare `prompt` with no messages is a user turn by definition.
      if (newest && newest.role !== 'user') {
        return { tripwireTriggered: false } as Awaited<
          ReturnType<InputGuardrail<M>['execute']>
        >;
      }
      return guardrail.execute(context, options);
    },
  };
}
