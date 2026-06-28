/**
 * `ai-sdk-guardrails/config` — the OpenAI-compatible, config-file-driven guardrail
 * runtime. This is a distinct execution model from the AI-SDK-native surface at
 * the package root (`withGuardrails`, `agentGuardrails`, `guardrailApproval`):
 * here guardrails are described declaratively (a pipeline/bundle config) and run
 * via `runGuardrails()` against plain text, independent of the AI SDK call graph.
 *
 * Reach for this when you want to author guardrails as configuration (e.g. to
 * mirror an OpenAI Guardrails setup) rather than wire them into a v7 model/agent.
 */

// Auto-register the OpenAI-compatible built-in guardrails on import.
import '../openai-guardrails';

export type {
  GuardrailConfig,
  GuardrailBundle,
  PipelineConfig,
  GuardrailBundleResult,
  GuardrailContext,
  // The same shared per-guardrail result shape as the package root; re-exported
  // here so config-runtime callers can import it from this subpath.
  GuardrailResult,
} from '../enhanced-types';

export {
  loadPipelineConfig,
  loadGuardrailBundle,
  validatePipelineConfig,
  runGuardrails,
  runStageGuardrails,
  checkPlainText,
  instantiateGuardrails,
  configUtils,
  runtimeUtils,
} from '../enhanced-runtime';

export {
  defaultRegistry,
  GuardrailRegistry,
  createRegistry,
} from '../registry';
export { GuardrailSpec, ConfiguredGuardrail } from '../spec';

export {
  mapOpenAIConfigToGuardrails,
  type GuardrailsConfigFromOpenAI,
} from '../config-mapper';

// Register enhanced specs into the registry as standard guardrails.
export { registerGuardrails } from '../adapters/spec-adapter';
