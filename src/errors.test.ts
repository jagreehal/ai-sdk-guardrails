import { describe, it, expect } from 'vitest';
import {
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
  type ValidationError,
} from './errors';

describe('Error System', () => {
  describe('GuardrailValidationError', () => {
    it('should create validation error with proper properties', () => {
      const validationErrors: ValidationError[] = [
        { field: 'prompt', message: 'Prompt is too long', code: 'LENGTH_EXCEEDED' },
        { field: 'system', message: 'System message is invalid', code: 'INVALID_FORMAT' },
      ];

      const error = new GuardrailValidationError(
        'content-filter',
        validationErrors,
        { userId: 'test123' }
      );

      expect(error.name).toBe('GuardrailValidationError');
      expect(error.code).toBe('GUARDRAIL_VALIDATION_FAILED');
      expect(error.guardrailName).toBe('content-filter');
      expect(error.validationErrors).toEqual(validationErrors);
      expect(error.metadata.userId).toBe('test123');
      expect(error.message).toContain('content-filter');
      expect(error.message).toContain('Prompt is too long');
    });

    it('should be serializable to JSON', () => {
      const validationErrors: ValidationError[] = [
        { message: 'Invalid input', code: 'INVALID' },
      ];
      
      const error = new GuardrailValidationError('test-guardrail', validationErrors);
      const json = error.toJSON();

      expect(json.name).toBe('GuardrailValidationError');
      expect(json.code).toBe('GUARDRAIL_VALIDATION_FAILED');
      expect(json.metadata.guardrailName).toBe('test-guardrail');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('GuardrailExecutionError', () => {
    it('should create execution error with original error', () => {
      const originalError = new Error('Network timeout');
      const error = new GuardrailExecutionError(
        'api-checker',
        originalError,
        { endpoint: '/api/check' }
      );

      expect(error.name).toBe('GuardrailExecutionError');
      expect(error.code).toBe('GUARDRAIL_EXECUTION_FAILED');
      expect(error.guardrailName).toBe('api-checker');
      expect(error.originalError).toBe(originalError);
      expect(error.message).toContain('api-checker');
      expect(error.message).toContain('Network timeout');
    });

    it('should create execution error without original error', () => {
      const error = new GuardrailExecutionError('simple-check');

      expect(error.originalError).toBeUndefined();
      expect(error.message).toBe('Guardrail "simple-check" execution failed');
    });
  });

  describe('GuardrailTimeoutError', () => {
    it('should create timeout error with proper properties', () => {
      const error = new GuardrailTimeoutError('slow-guardrail', 5000, { attempt: 1 });

      expect(error.name).toBe('GuardrailTimeoutError');
      expect(error.code).toBe('GUARDRAIL_TIMEOUT');
      expect(error.guardrailName).toBe('slow-guardrail');
      expect(error.timeoutMs).toBe(5000);
      expect(error.metadata.attempt).toBe(1);
      expect(error.message).toBe('Guardrail "slow-guardrail" timed out after 5000ms');
    });
  });

  describe('GuardrailConfigurationError', () => {
    it('should create configuration error with path', () => {
      const configErrors = ['Missing required field: name', 'Invalid timeout value'];
      const error = new GuardrailConfigurationError(
        configErrors,
        'guardrails.config.js',
        { line: 10 }
      );

      expect(error.name).toBe('GuardrailConfigurationError');
      expect(error.code).toBe('GUARDRAIL_CONFIG_INVALID');
      expect(error.configPath).toBe('guardrails.config.js');
      expect(error.configErrors).toEqual(configErrors);
      expect(error.message).toContain('guardrails.config.js');
      expect(error.message).toContain('Missing required field: name');
    });

    it('should create configuration error without path', () => {
      const configErrors = ['Invalid configuration'];
      const error = new GuardrailConfigurationError(configErrors);

      expect(error.configPath).toBeUndefined();
      expect(error.message).not.toContain(' in ');
    });
  });

  describe('InputBlockedError', () => {
    it('should create input blocked error', () => {
      const blockedGuardrails = [
        { name: 'content-filter', message: 'Inappropriate content', severity: 'high' as const },
        { name: 'length-check', message: 'Too long', severity: 'medium' as const },
      ];

      const error = new InputBlockedError(blockedGuardrails, { requestId: 'req123' });

      expect(error.name).toBe('InputBlockedError');
      expect(error.code).toBe('INPUT_BLOCKED');
      expect(error.blockedGuardrails).toEqual(blockedGuardrails);
      expect(error.message).toContain('content-filter, length-check');
      expect(error.message).toContain('guardrails'); // plural
    });

    it('should handle single guardrail', () => {
      const blockedGuardrails = [
        { name: 'single-check', message: 'Failed', severity: 'low' as const },
      ];

      const error = new InputBlockedError(blockedGuardrails);

      expect(error.message).toContain('guardrail:'); // singular
      expect(error.message).toContain('single-check');
    });
  });

  describe('OutputBlockedError', () => {
    it('should create output blocked error', () => {
      const blockedGuardrails = [
        { name: 'pii-filter', message: 'PII detected', severity: 'critical' as const },
      ];

      const error = new OutputBlockedError(blockedGuardrails, { responseId: 'res456' });

      expect(error.name).toBe('OutputBlockedError');
      expect(error.code).toBe('OUTPUT_BLOCKED');
      expect(error.blockedGuardrails).toEqual(blockedGuardrails);
      expect(error.message).toContain('pii-filter');
    });
  });

  describe('MiddlewareError', () => {
    it('should create middleware error with original error', () => {
      const originalError = new TypeError('Invalid parameter');
      const error = new MiddlewareError(
        'input',
        'transform',
        originalError,
        { step: 'validation' }
      );

      expect(error.name).toBe('MiddlewareError');
      expect(error.code).toBe('MIDDLEWARE_ERROR');
      expect(error.middlewareType).toBe('input');
      expect(error.phase).toBe('transform');
      expect(error.originalError).toBe(originalError);
      expect(error.message).toContain('input middleware transform error');
      expect(error.message).toContain('Invalid parameter');
    });

    it('should create middleware error without original error', () => {
      const error = new MiddlewareError('output', 'execute');

      expect(error.originalError).toBeUndefined();
      expect(error.message).toBe('output middleware execute error');
    });
  });

  describe('Error Detection and Utilities', () => {
    it('should detect guardrails errors', () => {
      const guardrailError = new GuardrailValidationError('test', []);
      const regularError = new Error('Regular error');

      expect(isGuardrailsError(guardrailError)).toBe(true);
      expect(isGuardrailsError(regularError)).toBe(false);
      expect(isGuardrailsError('string error')).toBe(false);
      expect(isGuardrailsError(null)).toBe(false);
    });

    it('should extract error info from guardrails error', () => {
      const error = new GuardrailTimeoutError('slow-check', 1000, { retry: true });
      const info = extractErrorInfo(error);

      expect(info.name).toBe('GuardrailTimeoutError');
      expect(info.code).toBe('GUARDRAIL_TIMEOUT');
      expect(info.message).toContain('slow-check');
      expect(info.metadata?.retry).toBe(true);
    });

    it('should extract error info from regular error', () => {
      const error = new TypeError('Invalid type');
      const info = extractErrorInfo(error);

      expect(info.name).toBe('TypeError');
      expect(info.message).toBe('Invalid type');
      expect(info.code).toBeUndefined();
      expect(info.metadata).toBeUndefined();
    });

    it('should extract error info from non-error values', () => {
      const info = extractErrorInfo('String error');

      expect(info.name).toBe('UnknownError');
      expect(info.message).toBe('String error');
    });
  });

  describe('Error Type Checking', () => {
    it('should check error types with is() method', () => {
      const validationError = new GuardrailValidationError('test', []);
      const timeoutError = new GuardrailTimeoutError('test', 1000);

      expect(validationError.is(GuardrailValidationError)).toBe(true);
      expect(validationError.is(GuardrailTimeoutError)).toBe(false);
      expect(timeoutError.is(GuardrailTimeoutError)).toBe(true);
      expect(timeoutError.is(GuardrailValidationError)).toBe(false);
    });
  });

  describe('Error Inheritance', () => {
    it('should maintain proper inheritance chain', () => {
      const error = new GuardrailValidationError('test', []);

      expect(error instanceof GuardrailValidationError).toBe(true);
      expect(error instanceof GuardrailsError).toBe(true);
      expect(error instanceof Error).toBe(true);
    });

    it('should have correct prototype chain', () => {
      const error = new InputBlockedError([]);

      expect(error.constructor.name).toBe('InputBlockedError');
      expect(Object.getPrototypeOf(error).constructor.name).toBe('InputBlockedError');
    });
  });

  describe('Error Metadata', () => {
    it('should include timestamp in all errors', () => {
      const error = new GuardrailExecutionError('test');
      const before = new Date();
      
      expect(error.timestamp).toBeInstanceOf(Date);
      expect(error.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime() - 100);
      expect(error.timestamp.getTime()).toBeLessThanOrEqual(new Date().getTime());
    });

    it('should merge metadata correctly', () => {
      const error = new GuardrailValidationError(
        'test',
        [],
        { custom: 'value', nested: { prop: 123 } }
      );

      expect(error.metadata.custom).toBe('value');
      expect(error.metadata.nested).toEqual({ prop: 123 });
      expect(error.metadata.guardrailName).toBe('test');
    });
  });

  describe('Error Serialization', () => {
    it('should serialize all error properties to JSON', () => {
      const originalError = new Error('Original');
      const error = new GuardrailExecutionError('test', originalError, { extra: 'data' });
      const json = error.toJSON();

      expect(json.name).toBe('GuardrailExecutionError');
      expect(json.code).toBe('GUARDRAIL_EXECUTION_FAILED');
      expect(json.message).toContain('test');
      expect(json.timestamp).toBeDefined();
      expect(json.metadata.guardrailName).toBe('test');
      expect(json.metadata.extra).toBe('data');
      expect(json.stack).toBeDefined();
    });

    it('should handle complex metadata in serialization', () => {
      const complexMetadata = {
        array: [1, 2, 3],
        object: { nested: true },
        date: new Date(),
        func: () => 'test', // functions should be handled gracefully
      };

      const error = new InputBlockedError([], complexMetadata);
      const json = error.toJSON();

      expect(json.metadata.array).toEqual([1, 2, 3]);
      expect(json.metadata.object).toEqual({ nested: true });
      expect(typeof json.metadata.date).toBe('object'); // Date should remain
    });
  });
});