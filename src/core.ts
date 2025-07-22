export type { InputGuardrail, OutputGuardrail } from './types';

// Export error classes
export {
  GuardrailsError,
  GuardrailValidationError,
  GuardrailExecutionError,
  GuardrailTimeoutError,
  GuardrailConfigurationError,
  InputBlockedError,
  OutputBlockedError,
  MiddlewareError,
  isGuardrailsError,
  extractErrorInfo,
} from './errors';

export function createInputGuardrail(
  name: string,
  description: string,
  execute: import('./types').InputGuardrail['execute'],
): import('./types').InputGuardrail {
  return { name, description, execute };
}

export function createOutputGuardrail(
  name: string,
  execute: import('./types').OutputGuardrail['execute'],
): import('./types').OutputGuardrail {
  return { name, execute };
}
