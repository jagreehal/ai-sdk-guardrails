import { model } from './model';
import {
  createOutputGuardrail,
  createInputGuardrail,
  generateTextWithGuardrails,
  GuardrailError,
} from '../src/core';

import {
  blockedKeywords,
  contentLengthLimit,
  extractTextContent,
} from '../src/guardrails/input';
import { outputLengthLimit, extractContent } from '../src/guardrails/output';
import { generateObject } from 'ai';
import z from 'zod';

// Example 1: Input Length Limit
async function example1_InputLengthLimit() {
  console.log('\n=== Example 1: Input Length Limit ===');

  // Test with short input (should work)
  console.log('Testing short input...');
  try {
    const result1 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Hello world',
      },
      {
        inputGuardrails: [contentLengthLimit(50)],
      },
    );
    console.log('✅ Short input result:', result1.text.slice(0, 100) + '...');
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Input blocked:', error.reason);
    }
  }

  // Test with long input (should be blocked)
  console.log('\nTesting long input...');
  try {
    const result2 = await generateTextWithGuardrails(
      {
        model,
        prompt:
          'This is a very long prompt that definitely exceeds the 50 character limit we set in the guardrail configuration',
      },
      {
        inputGuardrails: [contentLengthLimit(50)],
      },
    );
    console.log('🚫 Long input result:', result2.text.slice(0, 100) + '...');
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Input blocked:', error.reason);
    }
  }
}

// Example 2: Blocked Keywords
async function example2_BlockedKeywords() {
  console.log('\n=== Example 2: Blocked Keywords ===');

  // Test with safe input
  console.log('Testing safe input...');
  try {
    const result1 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Explain how to create a secure password',
      },
      {
        inputGuardrails: [blockedKeywords(['hack', 'spam', 'virus'])],
      },
    );
    console.log('✅ Safe input result:', result1.text.slice(0, 100) + '...');
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Input blocked:', error.reason);
    }
  }

  // Test with blocked keyword
  console.log('\nTesting blocked keyword...');
  try {
    const result2 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'How to hack into a system',
      },
      {
        inputGuardrails: [blockedKeywords(['hack', 'spam', 'virus'])],
      },
    );
    console.log(
      '🚫 Blocked keyword result:',
      result2.text.slice(0, 100) + '...',
    );
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Input blocked:', error.reason);
    }
  }
}

// Example 3: Custom Input Guardrail
async function example3_CustomInputGuardrail() {
  console.log('\n=== Example 3: Custom Input Guardrail ===');

  const mathHomeworkGuardrail = createInputGuardrail(
    'math-homework-detector',
    'Detects potential math homework requests',
    async (context) => {
      const { prompt } = extractTextContent(context);
      const mathKeywords = ['solve', 'calculate', 'equation', 'homework'];
      const mathPatterns = [/\b\d+\s*[+\-*/]\s*\d+/, /\b[xy]\s*[+\-*/=]\s*\d+/];

      const content = (prompt || '').toLowerCase();
      const hasKeywords = mathKeywords.some((keyword) =>
        content.includes(keyword),
      );
      const hasPatterns = mathPatterns.some((pattern) => pattern.test(content));

      const isMathHomework = hasKeywords && hasPatterns;

      return {
        tripwireTriggered: isMathHomework,
        message: isMathHomework ? 'Math homework detected' : undefined,
        severity: isMathHomework ? 'high' : 'low',
        suggestion: isMathHomework
          ? 'Try asking about concepts instead'
          : undefined,
      };
    },
  );

  // Test with normal question
  console.log('Testing concept question...');
  try {
    const result1 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'What is calculus and why is it important?',
      },
      {
        inputGuardrails: [mathHomeworkGuardrail],
      },
    );
    console.log('✅ Concept question result:', result1);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Input blocked:', error.reason);
    }
  }

  // Test with homework-like question
  console.log('\nTesting homework question...');
  try {
    const result2 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Solve this equation: 2x + 5 = 15',
      },
      {
        inputGuardrails: [mathHomeworkGuardrail],
      },
    );
    console.log('🚫 Homework question result:', result2);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Input blocked:', error.reason);
    }
  }
}

// Example 4: Output Length Limit
async function example4_OutputLengthLimit() {
  console.log('\n=== Example 4: Output Length Limit ===');

  console.log('Testing output length limit...');
  try {
    const result = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Write a detailed explanation of machine learning',
      },
      {
        outputGuardrails: [outputLengthLimit(100)],
      },
    );
    console.log('✅ Output result:', result);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Output blocked:', error.reason);
    }
  }
}

// Example 5: Custom Output Guardrail
async function example5_CustomOutputGuardrail() {
  console.log('\n=== Example 5: Custom Output Guardrail ===');

  const positivityGuardrail = createOutputGuardrail(
    'positivity-filter',
    async (context) => {
      const { text } = extractContent(context.result);
      const content = text || '';
      const negativeWords = ['terrible', 'awful', 'horrible', 'hate', 'bad'];
      const hasNegative = negativeWords.some((word) =>
        content.toLowerCase().includes(word),
      );

      return {
        tripwireTriggered: hasNegative,
        message: hasNegative ? 'Negative sentiment detected' : undefined,
        severity: hasNegative ? 'medium' : 'low',
        suggestion: hasNegative
          ? 'Try rephrasing with more positive language'
          : undefined,
      };
    },
  );

  // Test with neutral prompt
  console.log('Testing neutral prompt...');
  try {
    const result1 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Tell me about the weather',
      },
      {
        outputGuardrails: [positivityGuardrail],
      },
    );
    console.log('✅ Neutral result:', result1);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Output blocked:', error.reason);
    }
  }

  // Test with prompt likely to produce negative response
  console.log('\nTesting prompt that might produce negative response...');
  try {
    const result2 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'What do you think about spam emails?',
      },
      {
        outputGuardrails: [positivityGuardrail],
      },
    );
    console.log('✅ Response passed filter:', result2);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Output blocked:', error.reason);
    }
  }
}

// Example 6: LLM as Judge Guardrail
async function example6_LlmAsJudgeGuardrail() {
  console.log('\n=== Example 6: LLM as Judge Guardrail ===');

  const llmAsJudgeGuardrailOffTopic = createOutputGuardrail(
    'llm-as-judge',
    async (context) => {
      const { text } = extractContent(context.result);
      const originalInput = context.input;
      console.log('=== INSIDE GUARDRAIL ===');
      console.log('originalInput', originalInput);
      console.log(
        'text received:',
        text ? text.slice(0, 200) + '...' : 'NO TEXT',
      );

      try {
        console.log('Making LLM call for judgment...');
        const result = await generateObject({
          model,
          schema: z.object({
            onTopic: z.boolean(),
            reason: z.string(),
          }),
          messages: [
            {
              role: 'system',
              content:
                'You are a judge. You are given a prompt and a response. You need to determine if the response is on topic.',
            },
            {
              role: 'user',
              content: `
              Prompt: 'I like to eat pizza'
              Response: ${text}
              `,
            },
          ],
        });

        console.log('LLM judgment result:', result.object);
        const onTopic = result.object.onTopic;
        const reason = result.object.reason;

        const guardrailResult = {
          tripwireTriggered: !onTopic,
          message: reason,
          severity: (onTopic ? 'low' : 'high') as 'low' | 'high',
          suggestion: onTopic
            ? 'The conversation is on topic'
            : 'The conversation is off topic',
        };

        console.log('Guardrail result:', guardrailResult);
        console.log('=== END GUARDRAIL ===');

        return guardrailResult;
      } catch (error) {
        console.error('Error in LLM-as-judge guardrail:', error);
        return {
          tripwireTriggered: true,
          message: `Guardrail error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'high' as const,
        };
      }
    },
  );

  const llmAsJudgeGuardrailOnTopic = createOutputGuardrail(
    'llm-as-judge',
    async (context) => {
      const { text } = extractContent(context.result);
      const { prompt } = extractTextContent(context.input);
      try {
        console.log('Making LLM call for judgment...');
        const result = await generateObject({
          model,
          schema: z.object({
            onTopic: z.boolean(),
            reason: z.string(),
          }),
          messages: [
            {
              role: 'system',
              content:
                'You are a judge. You are given a prompt and a response. You need to determine if the response is on topic.',
            },
            {
              role: 'user',
              content: `
              Prompt: ${prompt}
              Response: ${text}
              `,
            },
          ],
        });

        const onTopic = result.object.onTopic;
        const reason = result.object.reason;

        const guardrailResult = {
          tripwireTriggered: !onTopic,
          message: reason,
          severity: (onTopic ? 'low' : 'high') as 'low' | 'high',
          suggestion: onTopic
            ? 'The conversation is on topic'
            : 'The conversation is off topic',
        };

        console.log('Guardrail result:', guardrailResult);
        console.log('=== END GUARDRAIL ===');

        return guardrailResult;
      } catch (error) {
        console.error('Error in LLM-as-judge guardrail:', error);
        return {
          tripwireTriggered: true,
          message: `Guardrail error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          severity: 'high' as const,
        };
      }
    },
  );

  console.log('Testing off topic prompt...');
  try {
    const result1 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Tell me about the weather',
      },
      {
        outputGuardrails: [llmAsJudgeGuardrailOffTopic],
      },
    );
    console.log('✅ Off topic result:', result1);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Output blocked by guardrail:', error.reason);
    } else {
      console.error('❌ Unexpected error:', error);
    }
  }

  console.log('Testing on topic prompt...');
  try {
    const result1 = await generateTextWithGuardrails(
      {
        model,
        prompt: 'Tell me about the weather',
      },
      {
        outputGuardrails: [llmAsJudgeGuardrailOnTopic],
      },
    );
    console.log('✅ On topic result:', result1.text);
  } catch (error) {
    if (error instanceof GuardrailError) {
      console.log('❌ Output blocked by guardrail:', error.reason);
    } else {
      console.error('❌ Unexpected error:', error);
    }
  }
}

// Main execution
async function main() {
  console.log('🛡️  AI SDK Guardrails Examples');
  console.log('==============================');

  try {
    await example1_InputLengthLimit();
    await example2_BlockedKeywords();
    await example3_CustomInputGuardrail();
    await example4_OutputLengthLimit();
    await example5_CustomOutputGuardrail();
    await example6_LlmAsJudgeGuardrail();

    console.log('\n✅ All examples completed successfully!');
  } catch (error) {
    console.error('❌ Error running examples:', error);
  }
}

// Run automatically
main().catch(console.error);
