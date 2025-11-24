import {
  Experimental_Agent as Agent,
  type Experimental_AgentSettings as AgentSettings,
  type ToolSet,
  type GenerateTextResult,
  type Prompt,
  type ProviderMetadata,
  type UIMessage,
  type InferUITools,
  type LanguageModelUsage,
  type StopCondition,
} from 'ai';
import { extractContent } from './output';
import { extractTextContent } from './input';
import { executeInputGuardrails, executeOutputGuardrails } from '../guardrails';
import type {
  InputGuardrail,
  OutputGuardrail,
  GuardrailExecutionSummary,
  InputGuardrailContext,
  NormalizedGuardrailContext,
  Logger,
  AIResult,
} from '../types';

type AnyRecord = Record<string, unknown>;

// Helper function to create a minimal GenerateTextResult for guardrail validation
function createMockGenerateTextResult<TOOLS extends ToolSet, OUTPUT>(
  text: string,
): GenerateTextResult<TOOLS, OUTPUT> {
  return {
    content: [],
    text,
    reasoning: [],
    reasoningText: undefined,
    files: [],
    sources: [],
    toolCalls: [],
    staticToolCalls: [],
    dynamicToolCalls: [],
    toolResults: [],
    staticToolResults: [],
    dynamicToolResults: [],
    finishReason: 'stop' as const,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    } as LanguageModelUsage,
    totalUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    } as LanguageModelUsage,
    warnings: undefined,
    request: {},
    response: {
      messages: [],
      id: '',
      timestamp: new Date(),
      modelId: '',
    },
    providerMetadata: undefined,
    steps: [],
    experimental_output: undefined as OUTPUT,
  } as GenerateTextResult<TOOLS, OUTPUT>;
}

// Extract the interface from the Agent class to ensure we stay in sync
type AgentInterface<
  TOOLS extends ToolSet,
  OUTPUT = never,
  OUTPUT_PARTIAL = never,
> = {
  generate: Agent<TOOLS, OUTPUT, OUTPUT_PARTIAL>['generate'];
  stream: Agent<TOOLS, OUTPUT, OUTPUT_PARTIAL>['stream'];
  respond: Agent<TOOLS, OUTPUT, OUTPUT_PARTIAL>['respond'];
  tools: Agent<TOOLS, OUTPUT, OUTPUT_PARTIAL>['tools'];
};

export interface AgentGuardrailsRetry {
  maxRetries?: number;
  backoffMs?: number | ((attempt: number) => number);
  buildRetryPrompt: (args: { lastPrompt: string; reason: string }) => string;
}

export interface AgentGuardrailsConfig<MIn = AnyRecord, MOut = AnyRecord> {
  inputGuardrails?: Array<InputGuardrail<MIn>>;
  outputGuardrails?: Array<OutputGuardrail<MOut>>;
  /** Guardrails that validate tool usage (applied on tool calls) */
  toolGuardrails?: Array<OutputGuardrail<MOut>>;
  /** If true, throw on blocked input/output; otherwise return original result */
  throwOnBlocked?: boolean;
  /** Replace blocked assistant text with a message */
  replaceOnBlocked?: boolean;
  retry?: AgentGuardrailsRetry;
  executionOptions?: {
    parallel?: boolean;
    timeout?: number;
    continueOnFailure?: boolean;
    logLevel?: 'none' | 'error' | 'warn' | 'info' | 'debug';
    logger?: Logger;
  };
  onInputBlocked?: (
    summary: GuardrailExecutionSummary<MIn>,
    context: InputGuardrailContext,
  ) => void;
  onOutputBlocked?: (
    summary: GuardrailExecutionSummary<MOut>,
    context: NormalizedGuardrailContext,
    stepIndex: number,
  ) => void;
  /**
   * Enable automatic early termination when guardrails are violated.
   * When enabled, adds stopWhen conditions to halt agent execution on:
   * - Critical severity violations
   * - Repeated guardrail violations (configurable threshold)
   * - Specific guardrail patterns
   *
   * Can be:
   * - boolean: true enables default behavior (stop on 3 violations or critical)
   * - number: stop after N violations
   * - function: custom stop condition based on guardrail history
   */
  stopOnGuardrailViolation?:
    | boolean
    | number
    | ((
        violations: Array<{ step: number; summary: GuardrailExecutionSummary }>,
      ) => boolean);
}

/**
 * Builds a stopWhen condition that integrates guardrail violations with user-defined stop conditions
 */
function buildGuardrailStopCondition<TOOLS extends ToolSet>(
  userStopWhen: StopCondition<TOOLS> | Array<StopCondition<TOOLS>> | undefined,
  stopOnViolation: AgentGuardrailsConfig['stopOnGuardrailViolation'],
  violationHistory: Array<{ step: number; summary: GuardrailExecutionSummary }>,
): StopCondition<TOOLS> | Array<StopCondition<TOOLS>> | undefined {
  if (!stopOnViolation) {
    return userStopWhen;
  }

  // Create guardrail-based stop condition
  const guardrailStopCondition: StopCondition<TOOLS> = () => {
    // Default behavior: stop on 3 violations or any critical
    if (stopOnViolation === true) {
      const criticalViolations = violationHistory.filter((v) =>
        v.summary.blockedResults.some(
          (r) => (r.severity ?? 'medium') === 'critical',
        ),
      );
      return violationHistory.length >= 3 || criticalViolations.length > 0;
    }

    // Number threshold: stop after N violations
    if (typeof stopOnViolation === 'number') {
      return violationHistory.length >= stopOnViolation;
    }

    // Custom function: user-defined logic
    if (typeof stopOnViolation === 'function') {
      return stopOnViolation(violationHistory);
    }

    return false;
  };

  // Combine with user's stopWhen if provided
  if (!userStopWhen) {
    return guardrailStopCondition;
  }

  // If user provided an array, add our condition to it
  if (Array.isArray(userStopWhen)) {
    return [...userStopWhen, guardrailStopCondition];
  }

  // User provided a single condition, create array with both
  return [userStopWhen, guardrailStopCondition];
}

function toNormalizedContextFromAgent(
  promptOrMessages: string | Array<{ role: string; content: unknown }>,
  system?: string,
): NormalizedGuardrailContext {
  const getLastByRole = <T extends { role: string }>(
    arr: T[],
    role: string,
  ): T | undefined => {
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i]?.role === role) {
        return arr[i];
      }
    }
    return undefined;
  };

  // String prompt path
  if (typeof promptOrMessages === 'string') {
    const { prompt: p, system: s } = extractTextContent({
      prompt: promptOrMessages,
      system,
      messages: [{ role: 'user', content: promptOrMessages }],
    } as {
      prompt: string;
      system: string;
      messages: Array<{ role: string; content: string }>;
    });
    return {
      prompt: p,
      system: s ?? '',
      messages: [{ role: 'user', content: p }],
    } as NormalizedGuardrailContext;
  }

  // UI messages path
  if (Array.isArray(promptOrMessages)) {
    // Flatten UI message parts into plain text for guardrail normalization
    const uiMessages = promptOrMessages as Array<{
      role: string;
      content: unknown;
    }>;
    const flattened = uiMessages.map((m) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content
            .filter((p: unknown) => (p as { type?: string })?.type === 'text')
            .map((p: unknown) => (p as { text?: string }).text)
            .join('') || ''
        : (m.content ?? ''),
    }));

    const lastUser = getLastByRole(flattened, 'user') || flattened.at(-1);

    // Also run through input extractor for consistent prompt/system derivation
    const simplifiedForExtractor = {
      messages: flattened.map((m) => ({ role: m.role, content: m.content })),
      system: system ?? '',
    } as { messages: Array<{ role: string; content: string }>; system: string };
    const { prompt: extractedPrompt, system: extractedSystem } =
      extractTextContent({
        ...simplifiedForExtractor,
        prompt: (lastUser?.content ?? '') as string,
      });

    const finalPrompt = lastUser?.content || extractedPrompt || '';

    return {
      prompt: finalPrompt,
      system: extractedSystem ?? system ?? '',
      messages: flattened,
    } as NormalizedGuardrailContext;
  }

  const { prompt: p2, system: s2 } = extractTextContent({
    prompt: String(promptOrMessages ?? ''),
    system,
    messages: [],
  } as {
    prompt: string;
    system: string;
    messages: Array<{ role: string; content: string }>;
  });
  return {
    prompt: p2,
    system: s2 ?? '',
    messages: [],
  } as NormalizedGuardrailContext;
}

/**
 * Wraps an AI SDK Agent by applying input, per-step output, and tool guardrails.
 * Accepts full AgentSettings for forward compatibility.
 */
export function withAgentGuardrails<
  TOOLS extends ToolSet,
  OUTPUT = never,
  OUTPUT_PARTIAL = never,
>(
  settings: AgentSettings<TOOLS, OUTPUT, OUTPUT_PARTIAL>,
  config: AgentGuardrailsConfig = {},
): AgentInterface<TOOLS, OUTPUT, OUTPUT_PARTIAL> {
  const {
    inputGuardrails = [],
    outputGuardrails = [],
    toolGuardrails = [],
    throwOnBlocked = false,
    replaceOnBlocked = true,
    retry,
    executionOptions,
    onInputBlocked,
    onOutputBlocked,
    stopOnGuardrailViolation,
  } = config;

  // Track guardrail violations across agent execution for stopWhen integration
  const violationHistory: Array<{
    step: number;
    summary: GuardrailExecutionSummary;
  }> = [];

  // Wrap tools to validate tool calls before/after execution
  const wrappedTools = Object.fromEntries(
    Object.entries(settings.tools ?? {}).map(([name, tool]) => {
      const originalExecute = (
        tool as unknown as { execute: (_input: unknown) => Promise<unknown> }
      ).execute;
      const wrapped = {
        ...(tool as Record<string, unknown>),
        execute: async (_input: unknown) => {
          // Pre-execution tool guardrails (validate intent/params allowlist, etc.)
          if (toolGuardrails.length > 0) {
            const context: NormalizedGuardrailContext = {
              prompt: JSON.stringify({ tool: name, input: _input }),
              system: settings.system ?? '',
              messages: [],
            };
            await executeOutputGuardrails(
              toolGuardrails,
              {
                input: context,
                // Treat tool-call as text for generic guardrails
                result: createMockGenerateTextResult<ToolSet, unknown>(''),
              },
              executionOptions,
            );
          }
          return originalExecute(_input);
        },
      };
      return [name, wrapped];
    }),
  ) as unknown as TOOLS;

  // Build stopWhen condition if guardrail-based early termination is enabled
  const enhancedStopWhen = buildGuardrailStopCondition(
    settings.stopWhen,
    stopOnGuardrailViolation,
    violationHistory,
  );

  // Create the underlying agent with enhanced stopWhen
  const baseAgent = new Agent<TOOLS, OUTPUT, OUTPUT_PARTIAL>({
    ...settings,
    tools: wrappedTools,
    ...(enhancedStopWhen ? { stopWhen: enhancedStopWhen } : {}),
  });

  async function checkInputGuardrails(normalized: NormalizedGuardrailContext) {
    if (inputGuardrails.length === 0) {
      return null;
    }

    const inputResults = await executeInputGuardrails(
      inputGuardrails,
      normalized,
      executionOptions,
    );
    const blocked = inputResults.filter((r) => r.tripwireTriggered);

    if (blocked.length > 0) {
      const summary = {
        allResults: inputResults,
        blockedResults: blocked,
        totalExecutionTime: 0,
        guardrailsExecuted: inputResults.length,
        stats: {
          passed: inputResults.length - blocked.length,
          blocked: blocked.length,
          failed: 0,
          averageExecutionTime: 0,
        },
      };
      onInputBlocked?.(summary, normalized);

      if (throwOnBlocked) {
        const msg = blocked
          .map((b) => b.message)
          .filter(Boolean)
          .join(', ');
        throw new Error(`Input blocked: ${msg || 'guardrail triggered'}`);
      }
      if (replaceOnBlocked) {
        return {
          text: `[Input blocked: ${blocked.map((b) => b.message).join(', ')}]`,
        };
      }
    }
    return null;
  }

  async function validateStepContent(
    step: { content: unknown },
    normalized: NormalizedGuardrailContext,
    stepIndex: number,
  ): Promise<GuardrailExecutionSummary | null> {
    const content = Array.isArray(step.content) ? step.content : [];
    let blockedSummary: GuardrailExecutionSummary | null = null;

    // Tool calls validation
    const hasToolCall = content.some(
      (c: unknown) => (c as { type?: string })?.type === 'tool-call',
    );
    if (hasToolCall && toolGuardrails.length > 0) {
      const ctx: NormalizedGuardrailContext = {
        prompt: normalized.prompt,
        system: normalized.system,
        messages: normalized.messages,
      };
      const res = await executeOutputGuardrails(
        toolGuardrails,
        {
          input: ctx,
          result: createMockGenerateTextResult<ToolSet, unknown>(''),
        },
        executionOptions,
      );
      const blocked = res.filter((r) => r.tripwireTriggered);
      if (blocked.length > 0) {
        blockedSummary = {
          allResults: res,
          blockedResults: blocked,
          totalExecutionTime: 0,
          guardrailsExecuted: res.length,
          stats: {
            passed: res.length - blocked.length,
            blocked: blocked.length,
            failed: 0,
            averageExecutionTime: 0,
          },
        } as GuardrailExecutionSummary;
        onOutputBlocked?.(blockedSummary, normalized, stepIndex);
        if (throwOnBlocked) {
          throw new Error(
            `Tool use blocked: ${blocked.map((b) => b.message).join(', ')}`,
          );
        }
      }
    }

    // Assistant text validation
    const text = content
      .filter((c: unknown) => (c as { type?: string })?.type === 'text')
      .map((c: unknown) => (c as { text?: string }).text ?? '')
      .join('');

    if (text && outputGuardrails.length > 0) {
      const ctx: NormalizedGuardrailContext = {
        prompt: normalized.prompt,
        system: normalized.system,
        messages: normalized.messages,
      };
      const out = await executeOutputGuardrails(
        outputGuardrails,
        {
          input: ctx,
          result: createMockGenerateTextResult<ToolSet, unknown>(text),
        },
        executionOptions,
      );
      const blocked = out.filter((r) => r.tripwireTriggered);
      if (blocked.length > 0) {
        blockedSummary = {
          allResults: out,
          blockedResults: blocked,
          totalExecutionTime: 0,
          guardrailsExecuted: out.length,
          stats: {
            passed: out.length - blocked.length,
            blocked: blocked.length,
            failed: 0,
            averageExecutionTime: 0,
          },
        } as GuardrailExecutionSummary;
        onOutputBlocked?.(blockedSummary, normalized, stepIndex);
      }
    }

    return blockedSummary;
  }

  async function guardedGenerate(
    options: Prompt & {
      providerMetadata?: ProviderMetadata;
    },
  ): Promise<GenerateTextResult<TOOLS, OUTPUT>> {
    const normalized = toNormalizedContextFromAgent(
      (options?.prompt ?? options?.messages) as
        | string
        | Array<{ role: string; content: unknown }>,
      settings.system,
    );

    // Input guardrails first
    const inputBlocked = await checkInputGuardrails(normalized);
    if (inputBlocked) {
      // Return a minimal GenerateTextResult for blocked input
      return createMockGenerateTextResult<TOOLS, OUTPUT>(inputBlocked.text);
    }

    let attempts = 0;
    let promptValue = options?.prompt ?? options?.messages;

    // Auto-retry loop on output guardrails
    while (true) {
      const result = await baseAgent.generate({
        prompt: promptValue,
      } as Parameters<typeof baseAgent.generate>[0]);

      // Validate steps
      if (outputGuardrails.length > 0 || toolGuardrails.length > 0) {
        for (let i = 0; i < (result.steps?.length ?? 0); i++) {
          const step = result.steps?.[i];
          if (!step) {
            continue;
          }

          const blockedSummary = await validateStepContent(step, normalized, i);

          if (blockedSummary) {
            // Track violation for stopWhen integration
            violationHistory.push({ step: i, summary: blockedSummary });

            // Retry if configured
            if (retry && attempts < (retry.maxRetries ?? 0)) {
              attempts += 1;
              const wait =
                typeof retry.backoffMs === 'function'
                  ? retry.backoffMs(attempts)
                  : (retry.backoffMs ?? 0);
              if (wait > 0) {
                await new Promise((r) => setTimeout(r, wait));
              }
              const reason = blockedSummary.blockedResults
                .map((b) => b.message)
                .filter(Boolean)
                .join(', ');
              const currentPromptText =
                typeof promptValue === 'string'
                  ? promptValue
                  : normalized.prompt;
              promptValue = retry.buildRetryPrompt({
                lastPrompt: currentPromptText,
                reason,
              });
              continue;
            }

            if (throwOnBlocked) {
              throw new Error(
                `Output blocked: ${blockedSummary.blockedResults.map((b) => b.message).join(', ')}`,
              );
            }

            if (replaceOnBlocked) {
              const replaced = `[Output blocked: ${blockedSummary.blockedResults.map((b) => b.message).join(', ')}]`;
              const { text: full } = extractContent(
                result as unknown as AIResult,
              );
              const finalText = full.replace('', replaced);
              return {
                ...result,
                text: finalText,
              } as GenerateTextResult<TOOLS, OUTPUT>;
            }
          }
        }
      }

      return result;
    }
  }

  return {
    generate: guardedGenerate,
    stream: (
      opts: Prompt & {
        providerMetadata?: ProviderMetadata;
      },
    ) => baseAgent.stream(opts),
    respond: (opts: {
      messages: UIMessage<never, never, InferUITools<TOOLS>>[];
    }) => baseAgent.respond(opts),
    tools: wrappedTools,
  };
}
