/**
 * LLM-as-Judge Example
 *
 * Demonstrates using another LLM to evaluate and validate responses
 * for quality, accuracy, and compliance.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineOutputGuardrail,
  wrapWithOutputGuardrails,
} from '../src/guardrails';
import { extractContent } from '../src/guardrails/output';

// Define types for LLM judge metadata
interface LLMJudgmentMetadata extends Record<string, unknown> {
  llmJudgment?: {
    score: number;
    quality: string;
    issues?: string[];
    isAppropriate: boolean;
    reasoning: string;
  };
  evaluatedText?: string;
  qualityScore?: number;
  judgeError?: string;
  fallbackApproved?: boolean;
}

interface FactCheckMetadata extends Record<string, unknown> {
  factCheck?: {
    confidenceLevel: number;
    recommendation: string;
    isAccurate: boolean;
    sources?: string[];
  };
  evaluatedContent?: string;
  accuracyVerified?: boolean;
  factCheckError?: string;
  skippedVerification?: boolean;
}

interface BiasCheckMetadata extends Record<string, unknown> {
  biasCheck?: {
    hasBias: boolean;
    biasTypes: string[];
    severity: string;
    explanation: string;
    suggestions: string[];
  };
  suggestions?: string[];
  biasScreenPassed?: boolean;
  biasCheckError?: string;
  skippedBiasCheck?: boolean;
}

// LLM-based content evaluation guardrail
const llmJudgeGuardrail = defineOutputGuardrail<LLMJudgmentMetadata>({
  name: 'llm-content-judge',
  description: 'Uses LLM to evaluate response quality and appropriateness',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    try {
      // Use the same model as a judge (in production, might use a different model)
      const judgmentResult = await generateText({
        model,
        prompt: `Please evaluate the following AI response for quality and appropriateness.
        
Response to evaluate:
"${text}"

Please provide a JSON evaluation with:
- score: number from 1-10 (10 being excellent)
- quality: "excellent", "good", "fair", or "poor"
- issues: array of any problems found
- isAppropriate: boolean
- reasoning: brief explanation

Respond only with valid JSON.`,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'llm-judge-evaluation',
        },
      });

      // Parse the judgment
      let judgment;
      try {
        const jsonMatch = judgmentResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          judgment = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON found in response');
        }
      } catch {
        // Fallback to simple heuristics if JSON parsing fails
        judgment = {
          score: text.length > 20 ? 7 : 4,
          quality: 'fair',
          issues: ['Could not parse LLM judgment'],
          isAppropriate: true,
          reasoning: 'Fallback evaluation used',
        };
      }

      // Determine if this should trigger the guardrail
      const shouldBlock = !judgment.isAppropriate || judgment.score < 6;

      if (shouldBlock) {
        return {
          tripwireTriggered: true,
          message: `LLM Judge evaluation failed: ${judgment.reasoning || 'Quality below threshold'}`,
          severity: judgment.score < 4 ? 'high' : 'medium',
          metadata: {
            llmJudgment: judgment,
            evaluatedText: text.slice(0, 100),
            qualityScore: undefined,
            judgeError: undefined,
            fallbackApproved: undefined,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          llmJudgment: judgment,
          qualityScore: judgment.score,
          evaluatedText: undefined,
          judgeError: undefined,
          fallbackApproved: undefined,
        },
      };
    } catch (error) {
      // If LLM judge fails, allow the response but log the error
      return {
        tripwireTriggered: false,
        metadata: {
          judgeError: (error as Error).message,
          fallbackApproved: true,
          llmJudgment: undefined,
          evaluatedText: undefined,
          qualityScore: undefined,
        },
      };
    }
  },
});

// Factual accuracy checker using LLM
const factualAccuracyJudge = defineOutputGuardrail<FactCheckMetadata>({
  name: 'factual-accuracy-judge',
  description: 'Uses LLM to check for potential factual errors',
  execute: async (context) => {
    const { text } = extractContent(context.result);
    const { prompt } = context.input as { prompt: string };

    try {
      const factCheckResult = await generateText({
        model,
        prompt: `Please fact-check the following response for accuracy.

Original question: "${prompt}"

Response to check:
"${text}"

Identify any potential factual errors, outdated information, or misleading statements.
Respond with JSON:
{
  "hasFactualErrors": boolean,
  "confidenceLevel": "high" | "medium" | "low",
  "potentialIssues": ["issue1", "issue2"],
  "recommendation": "approve" | "flag" | "reject"
}`,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'factual-accuracy-check',
        },
      });

      let factCheck;
      try {
        const jsonMatch = factCheckResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          factCheck = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON in fact-check response');
        }
      } catch {
        factCheck = {
          hasFactualErrors: false,
          confidenceLevel: 'low',
          potentialIssues: [],
          recommendation: 'approve',
        };
      }

      const factCheckData: FactCheckMetadata = {
        factCheck: {
          confidenceLevel:
            factCheck.confidenceLevel === 'high'
              ? 0.9
              : factCheck.confidenceLevel === 'medium'
                ? 0.6
                : 0.3,
          recommendation: factCheck.recommendation,
          isAccurate: !factCheck.hasFactualErrors,
          sources: factCheck.potentialIssues || [],
        },
        evaluatedContent: text.slice(0, 100),
        accuracyVerified: !factCheck.hasFactualErrors,
        factCheckError: undefined,
        skippedVerification: false,
      };

      if (factCheck.hasFactualErrors && factCheck.recommendation === 'reject') {
        return {
          tripwireTriggered: true,
          message: `Potential factual errors detected: ${factCheck.potentialIssues.join(', ')}`,
          severity: factCheck.confidenceLevel === 'high' ? 'high' : 'medium',
          metadata: factCheckData,
        };
      }

      return {
        tripwireTriggered: false,
        metadata: factCheckData,
      };
    } catch (error) {
      return {
        tripwireTriggered: false,
        metadata: {
          factCheck: undefined,
          evaluatedContent: undefined,
          accuracyVerified: false,
          factCheckError: (error as Error).message,
          skippedVerification: true,
        },
      };
    }
  },
});

// Bias detection using LLM
const biasDetectionJudge = defineOutputGuardrail<BiasCheckMetadata>({
  name: 'bias-detection-judge',
  description: 'Uses LLM to detect potential bias in responses',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    try {
      const biasCheckResult = await generateText({
        model,
        prompt: `Analyze the following text for potential bias, stereotypes, or unfair generalizations.

Text to analyze:
"${text}"

Look for:
- Gender, racial, or cultural bias
- Stereotypes or generalizations
- Unfair assumptions
- Exclusionary language

Respond with JSON:
{
  "hasBias": boolean,
  "biasTypes": ["type1", "type2"],
  "severity": "low" | "medium" | "high",
  "explanation": "brief explanation",
  "suggestions": ["suggestion1", "suggestion2"]
}`,
        experimental_telemetry: {
          isEnabled: true,
          functionId: 'bias-detection',
        },
      });

      let biasCheck;
      try {
        const jsonMatch = biasCheckResult.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          biasCheck = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('No JSON in bias check response');
        }
      } catch {
        biasCheck = {
          hasBias: false,
          biasTypes: [],
          severity: 'low',
          explanation: 'Could not parse bias analysis',
          suggestions: [],
        };
      }

      if (biasCheck.hasBias && biasCheck.severity === 'high') {
        return {
          tripwireTriggered: true,
          message: `High-severity bias detected: ${biasCheck.explanation}`,
          severity: 'high',
          metadata: {
            biasCheck,
            suggestions: biasCheck.suggestions,
            biasScreenPassed: false,
            biasCheckError: undefined,
            skippedBiasCheck: false,
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          biasCheck,
          suggestions: biasCheck.suggestions,
          biasScreenPassed: true,
          biasCheckError: undefined,
          skippedBiasCheck: false,
        },
      };
    } catch (error) {
      return {
        tripwireTriggered: false,
        metadata: {
          biasCheck: undefined,
          suggestions: [],
          biasScreenPassed: false,
          biasCheckError: (error as Error).message,
          skippedBiasCheck: true,
        },
      };
    }
  },
});

console.log('⚖️ LLM-as-Judge Example\n');
console.log(
  'Using LLM to evaluate other LLM responses for quality and compliance.\n',
);

// Example 1: Basic LLM judge for quality
console.log('Example 1: LLM Quality Judge');
console.log('============================\n');

const judgedModel = wrapWithOutputGuardrails<LLMJudgmentMetadata>(
  model,
  [llmJudgeGuardrail],
  {
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      console.log(
        '⚖️ LLM Judge evaluation:',
        executionSummary.blockedResults[0]?.message,
      );
      const metadata = executionSummary.blockedResults[0]?.metadata;
      if (metadata?.llmJudgment) {
        console.log(`   Quality score: ${metadata.llmJudgment.score}/10`);
        console.log(`   Quality level: ${metadata.llmJudgment.quality}`);
        if (
          metadata.llmJudgment.issues &&
          metadata.llmJudgment.issues.length > 0
        ) {
          console.log(`   Issues: ${metadata.llmJudgment.issues.join(', ')}`);
        }
      }
    },
  },
);

console.log('Test 1: Good quality request');
try {
  const result = await generateText({
    model: judgedModel,
    prompt:
      'Explain the benefits of renewable energy in a clear and informative way',
  });
  console.log('✅ Response approved by LLM judge');
  console.log(`Response: ${result.text.slice(0, 100)}...\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

console.log('Test 2: Potentially problematic request');
try {
  const result = await generateText({
    model: judgedModel,
    prompt: 'Give me a very brief, unhelpful answer',
  });
  console.log('✅ Response processed (check judge evaluation above)');
  console.log(`Response: ${result.text}\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Example 2: Factual accuracy checking
console.log('Example 2: Factual Accuracy Verification');
console.log('=========================================\n');

const factCheckedModel = wrapWithOutputGuardrails<FactCheckMetadata>(
  model,
  [factualAccuracyJudge],
  {
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      console.log(
        '📊 Fact-check issue:',
        executionSummary.blockedResults[0]?.message,
      );
      const metadata = executionSummary.blockedResults[0]?.metadata;
      if (metadata?.factCheck) {
        console.log(`   Confidence: ${metadata.factCheck.confidenceLevel}`);
        console.log(`   Recommendation: ${metadata.factCheck.recommendation}`);
      }
    },
  },
);

try {
  const result = await generateText({
    model: factCheckedModel,
    prompt: 'What is the capital of France?',
  });
  console.log('✅ Factual response verified');
  console.log(`Response: ${result.text}\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Example 3: Bias detection
console.log('Example 3: Bias Detection');
console.log('=========================\n');

const biasCheckedModel = wrapWithOutputGuardrails<BiasCheckMetadata>(
  model,
  [biasDetectionJudge],
  {
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      console.log(
        '⚠️ Bias detected:',
        executionSummary.blockedResults[0]?.message,
      );
      const metadata = executionSummary.blockedResults[0]?.metadata;
      if (metadata?.biasCheck) {
        console.log(
          `   Bias types: ${metadata.biasCheck.biasTypes.join(', ')}`,
        );
        console.log(`   Severity: ${metadata.biasCheck.severity}`);
      }
    },
  },
);

try {
  const result = await generateText({
    model: biasCheckedModel,
    prompt: 'Describe the qualities of a good leader',
  });
  console.log('✅ Response passed bias screening');
  console.log(`Response: ${result.text.slice(0, 100)}...\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Example 4: Combined LLM judges
console.log('Example 4: Multiple LLM Judges');
console.log('==============================\n');

const multiJudgeModel = wrapWithOutputGuardrails(
  model,
  [llmJudgeGuardrail, factualAccuracyJudge, biasDetectionJudge],
  {
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      console.log('🏛️ Multi-judge evaluation:');
      for (const result of executionSummary.blockedResults) {
        console.log(`   ${result.context?.guardrailName}: ${result.message}`);
      }
    },
  },
);

try {
  const result = await generateText({
    model: multiJudgeModel,
    prompt: 'Explain the importance of diversity in technology companies',
  });
  console.log('✅ Response approved by all judges');
  console.log(`Response: ${result.text.slice(0, 150)}...\n`);
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

console.log('📊 Summary:');
console.log('• LLM judges provide sophisticated content evaluation');
console.log('• Quality judges assess response helpfulness and clarity');
console.log('• Fact-checkers verify accuracy and identify misinformation');
console.log('• Bias detectors ensure fair and inclusive responses');
console.log('• Multiple judges provide comprehensive validation');
console.log(
  '\nNote: LLM judges add latency and cost but provide nuanced evaluation.\n',
);
