/**
 * Example: Guardrails with OpenTelemetry Integration
 *
 * This example demonstrates how to use OpenTelemetry to observe
 * guardrail execution in your distributed tracing system.
 *
 * Prerequisites:
 * - Install @opentelemetry/api: pnpm add @opentelemetry/api
 * - Install tracing packages (example uses Jaeger exporter):
 *   pnpm add @opentelemetry/sdk-trace-node @opentelemetry/exporter-trace-otlp-http
 *
 * To run this example:
 * 1. Start Jaeger: docker run -d -p16686:16686 -p4318:4318 jaegertracing/all-in-one:latest
 * 2. Run: tsx examples/52-guardrails-with-telemetry.ts
 * 3. View traces at http://localhost:16686
 */

import { generateText } from 'ai';
import { withGuardrails, defineInputGuardrail, defineOutputGuardrail } from 'ai-sdk-guardrails';
import { extractTextContent } from 'ai-sdk-guardrails/guardrails/input';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';
import { trace } from '@opentelemetry/api';
import 'dotenv/config';
import { llama3_2 } from './model';

// Initialize OpenTelemetry (simplified for example)
// In production, you'd use a proper SDK setup
const tracer = trace.getTracer('guardrails-example', '1.0.0');

// Define some example guardrails
const piiDetector = defineInputGuardrail({
  name: 'pii-detector',
  version: '1.0.0',
  priority: 'high',
  tags: ['security', 'compliance'],
  execute: async (context) => {
    // Simulate PII detection
    const { prompt } = extractTextContent(context);
    const hasPII = /\b\d{3}-\d{2}-\d{4}\b/.test(prompt);

    return {
      tripwireTriggered: hasPII,
      message: hasPII ? 'Potential SSN detected in input' : 'No PII detected',
      severity: hasPII ? 'critical' : 'low',
      metadata: {
        patterns: hasPII ? ['ssn'] : [],
        scannedLength: prompt.length,
      },
    };
  },
});

const minLengthGuardrail = defineOutputGuardrail({
  name: 'min-length',
  version: '1.0.0',
  priority: 'medium',
  tags: ['quality'],
  execute: async (context) => {
    const { text } = extractContent(context.result);
    const output = text || '';
    const minLength = 50;
    const isTooShort = output.length < minLength;

    return {
      tripwireTriggered: isTooShort,
      message: isTooShort
        ? `Output too short (${output.length} < ${minLength})`
        : 'Output length OK',
      severity: isTooShort ? 'medium' : 'low',
      metadata: {
        actualLength: output.length,
        minLength,
        deficit: isTooShort ? minLength - output.length : 0,
      },
    };
  },
});

async function example1BasicTelemetry() {
  console.log('\n=== Example 1: Basic Telemetry ===\n');

  // Wrap model with guardrails and enable telemetry
  const guardedModel = withGuardrails(llama3_2, {
    inputGuardrails: [piiDetector],
    outputGuardrails: [minLengthGuardrail],
    executionOptions: {
      telemetry: {
        isEnabled: true,
        tracer: tracer,
        recordInputs: true,
        recordOutputs: true,
        recordMetadata: true,
        metadata: {
          'app.environment': 'development',
          'app.version': '1.0.0',
        },
      },
    },
  });

  try {
    const result = await generateText({
      model: guardedModel,
      prompt: 'Explain quantum computing in simple terms.',
    });

    console.log('✅ Generation successful!');
    console.log('Output:', result.text.slice(0, 100) + '...');
    console.log('\n📊 Check your tracing UI for guardrail spans!');
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

async function example2BlockedInput() {
  console.log('\n=== Example 2: Blocked Input (PII Detection) ===\n');

  const guardedModel = withGuardrails(llama3_2, {
    inputGuardrails: [piiDetector],
    throwOnBlocked: true, // Throw error when input is blocked
    executionOptions: {
      telemetry: {
        isEnabled: true,
        tracer: tracer,
        metadata: {
          'test.scenario': 'blocked-input',
        },
      },
    },
  });

  try {
    const result = await generateText({
      model: guardedModel,
      prompt: 'My SSN is 123-45-6789. Can you help me?', // Contains PII
    });

    console.log('Result:', result.text);
  } catch (error) {
    console.log('❌ Input blocked by guardrails (as expected)');
    console.log('Error:', (error as Error).message);
    console.log(
      '\n📊 Check traces - you should see a guardrail.triggered=true span',
    );
  }
}

async function example3WithoutTelemetry() {
  console.log('\n=== Example 3: Without Telemetry (Default) ===\n');

  // When telemetry is not configured, guardrails work normally
  // without any tracing overhead
  const guardedModel = withGuardrails(llama3_2, {
    inputGuardrails: [piiDetector],
    outputGuardrails: [minLengthGuardrail],
    // No executionOptions.telemetry - telemetry disabled by default
  });

  try {
    const result = await generateText({
      model: guardedModel,
      prompt: 'What is TypeScript?',
    });

    console.log('✅ Generation successful (no telemetry overhead)');
    console.log('Output:', result.text.slice(0, 100) + '...');
  } catch (error) {
    console.error('Error:', error);
  }
}

async function example4SelectiveTelemetry() {
  console.log('\n=== Example 4: Selective Telemetry (No Sensitive Data) ===\n');

  const guardedModel = withGuardrails(llama3_2, {
    inputGuardrails: [piiDetector],
    outputGuardrails: [minLengthGuardrail],
    executionOptions: {
      telemetry: {
        isEnabled: true,
        tracer: tracer,
        recordInputs: false, // Don't record inputs (may contain PII)
        recordOutputs: false, // Don't record outputs (may contain sensitive data)
        recordMetadata: true, // Only record metadata (safe aggregated info)
        metadata: {
          'compliance.pii_recording': false,
        },
      },
    },
  });

  try {
    const result = await generateText({
      model: guardedModel,
      prompt: 'Explain GDPR compliance.',
    });

    console.log('✅ Generation successful');
    console.log('Output:', result.text.slice(0, 100) + '...');
    console.log('\n📊 Traces recorded without sensitive input/output content');
  } catch (error) {
    console.error('Error:', error);
  }
}

async function example5ProductionSetup() {
  console.log('\n=== Example 5: Production Setup with Context ===\n');

  // In production, you'd extract these from request context
  const requestId = `req_${Date.now()}`;
  const userId = 'user_123';
  const sessionId = 'session_abc';

  const guardedModel = withGuardrails(llama3_2, {
    inputGuardrails: [piiDetector],
    outputGuardrails: [minLengthGuardrail],
    executionOptions: {
      telemetry: {
        isEnabled: process.env.NODE_ENV === 'production',
        tracer: tracer,
        functionId: 'chat-completion',
        metadata: {
          // Add context for distributed tracing
          'request.id': requestId,
          'user.id': userId,
          'session.id': sessionId,
          'deployment.environment': process.env.NODE_ENV || 'development',
        },
      },
      logLevel: 'warn', // Only log warnings and errors
    },
    onInputBlocked: (summary) => {
      // Production monitoring: alert on blocked inputs
      console.log(
        `⚠️  Input blocked - ${summary.blockedResults.length} guardrails triggered`,
      );
      // In production: send to monitoring service
    },
    onOutputBlocked: (summary) => {
      // Production monitoring: alert on blocked outputs
      console.log(
        `⚠️  Output blocked - ${summary.blockedResults.length} guardrails triggered`,
      );
      // In production: send to monitoring service
    },
  });

  try {
    const result = await generateText({
      model: guardedModel,
      prompt: 'What are best practices for data privacy?',
    });

    console.log('✅ Production request completed');
    console.log('Request ID:', requestId);
    console.log('Output:', result.text.slice(0, 100) + '...');
    console.log(
      '\n📊 All context (requestId, userId, sessionId) included in traces',
    );
  } catch (error) {
    console.error('Error:', error);
  }
}

// Main execution
async function main() {
  console.log('🔍 Guardrails + OpenTelemetry Examples\n');
  console.log(
    'Note: These examples will work with or without a tracing backend.',
  );
  console.log(
    'For full experience, run Jaeger: docker run -p16686:16686 -p4318:4318 jaegertracing/all-in-one\n',
  );

  try {
    await example1BasicTelemetry();
    await example2BlockedInput();
    await example3WithoutTelemetry();
    await example4SelectiveTelemetry();
    await example5ProductionSetup();

    console.log('\n✅ All examples completed!');
    console.log('\n📊 Trace Visualization:');
    console.log('  • View at: http://localhost:16686');
    console.log('  • Service: ai-sdk-guardrails');
    console.log('  • Look for spans like:');
    console.log('    - guardrail.input.pii-detector');
    console.log('    - guardrail.output.min-length');
    console.log('  • Check span attributes for:');
    console.log('    - guardrail.triggered');
    console.log('    - guardrail.severity');
    console.log('    - guardrail.execution_time_ms');
    console.log('    - guardrail.metadata.*');
  } catch (error) {
    console.error('Fatal error:', error);
    throw error;
  }
}

main();
