/**
 * Hallucination Detection Example
 *
 * Demonstrates how to detect and prevent hallucinations in AI responses
 * using LLM-as-judge verification, fact-checking patterns, confidence scoring,
 * and forced hedging for uncertain claims. This is critical for RAG applications
 * and factual accuracy.
 */

import { generateObject } from 'ai';
import { generateText } from 'ai-sdk-ollama';
import { llama3_2 as model } from './model';
import { defineOutputGuardrail, withGuardrails } from '../src/index';
import { z } from 'zod';

// Define types for hallucination detection metadata
interface HallucinationDetectionMetadata extends Record<string, unknown> {
  confidenceScore?: number;
  riskLevel?: string;
  claimsFound?: number;
  claimsVerified?: number;
  verifications?: Array<{
    confidence: number;
    requiresCitation: boolean;
    isVerifiable: boolean;
    riskLevel: string;
    reasoning: string;
    factCheckRequired: boolean;
    suggestedHedging?: string;
  }>;
  factors?: string[];
  hedgingSuggestions?: string[];
  textLength?: number;
  hasHedgingLanguage?: boolean;
  claims?: Array<{
    type: string;
    claim: string;
    position: { start: number; end: number };
  }>;
}

// Define fact-checking patterns and verification strategies
const FACT_CHECKING_PATTERNS = {
  // High-confidence factual claims that need verification
  factualClaims: [
    /according to (research|studies|data|statistics)/gi,
    /(research|studies|data) (shows|indicates|demonstrates|proves)/gi,
    /(statistics|data) (show|indicate|demonstrate|prove)/gi,
    /(scientists|researchers|experts) (found|discovered|concluded)/gi,
    /(study|research) (found|discovered|concluded)/gi,
    /(percentage|percent|%) of/gi,
    /(number|amount|total) of/gi,
    /(date|year|month|day) (was|is|will be)/gi,
    /(location|place|city|country) (is|was|will be)/gi,
    /(person|company|organization) (said|stated|announced)/gi,
  ],

  // Claims that require specific citations
  citationRequired: [
    /(research|study|paper|article) (by|from|published)/gi,
    /(book|journal|publication) (by|from|published)/gi,
    /(author|researcher|scientist) (wrote|published|found)/gi,
    /(source|reference|citation) (says|states|indicates)/gi,
  ],

  // Claims about current events or recent information
  currentEvents: [
    /(recently|lately|currently|now) (announced|released|published)/gi,
    /(latest|new|recent) (data|information|research)/gi,
    /(this|last) (week|month|year)/gi,
    /(today|yesterday|tomorrow)/gi,
    /(breaking|news|update)/gi,
  ],

  // Claims about specific numbers or statistics
  numericalClaims: [
    /(\d+(?:\.\d+)?)\s*(percent|%|million|billion|thousand)/gi,
    /(more than|less than|approximately|about|around)\s*\d+/gi,
    /(between|from)\s*\d+\s*(and|to)\s*\d+/gi,
    /(increased|decreased|grew|declined)\s*by\s*\d+/gi,
  ],
};

// Define hedging patterns for uncertain claims
const HEDGING_PATTERNS = [
  'may',
  'might',
  'could',
  'possibly',
  'potentially',
  'seems',
  'appears',
  'suggests',
  'indicates',
  'likely',
  'probably',
  'perhaps',
  'maybe',
  'allegedly',
  'reportedly',
  'supposedly',
  'according to some',
  'some sources suggest',
  'it has been suggested',
  'there is some evidence',
];

// LLM-as-judge verification schema
const verificationSchema = z.object({
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence level in the factual accuracy (0-1)'),
  requiresCitation: z
    .boolean()
    .describe('Whether this claim requires a specific citation'),
  isVerifiable: z
    .boolean()
    .describe('Whether this claim can be verified with external sources'),
  riskLevel: z
    .enum(['low', 'medium', 'high', 'critical'])
    .describe('Risk level of potential hallucination'),
  reasoning: z
    .string()
    .describe('Reasoning for the confidence level and risk assessment'),
  suggestedHedging: z
    .string()
    .optional()
    .describe('Suggested hedging language if confidence is low'),
  factCheckRequired: z
    .boolean()
    .describe('Whether this claim requires fact-checking'),
});

// Extract factual claims from text
function extractFactualClaims(text: string): Array<{
  claim: string;
  type: string;
  pattern: string;
  position: { start: number; end: number };
}> {
  const claims: Array<{
    claim: string;
    type: string;
    pattern: string;
    position: { start: number; end: number };
  }> = [];

  // Check each pattern category
  for (const [category, patterns] of Object.entries(FACT_CHECKING_PATTERNS)) {
    for (const pattern of patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match.index !== undefined) {
          // Extract a reasonable context around the match
          const start = Math.max(0, match.index - 50);
          const end = Math.min(
            text.length,
            match.index + match[0].length + 100,
          );
          const claim = text.slice(start, end).trim();

          claims.push({
            claim,
            type: category,
            pattern: pattern.source,
            position: {
              start: match.index,
              end: match.index + match[0].length,
            },
          });
        }
      }
    }
  }

  return claims;
}

// Check if text contains hedging language
function hasHedgingLanguage(text: string): boolean {
  const lowerText = text.toLowerCase();
  return HEDGING_PATTERNS.some((hedge) => lowerText.includes(hedge));
}

// Calculate confidence score based on various factors
function calculateConfidenceScore(
  text: string,
  claims: Array<{
    claim: string;
    type: string;
    pattern: string;
    position: { start: number; end: number };
  }>,
): {
  score: number;
  factors: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
} {
  let score = 1;
  const factors: string[] = [];

  // Reduce confidence for each factual claim without hedging
  const unhedgedClaims = claims.filter((claim) => {
    const claimText = claim.claim.toLowerCase();
    return !hasHedgingLanguage(claimText);
  });

  if (unhedgedClaims.length > 0) {
    score -= unhedgedClaims.length * 0.15;
    factors.push(`${unhedgedClaims.length} unhedged factual claims`);
  }

  // Reduce confidence for claims requiring citations
  const citationRequiredClaims = claims.filter(
    (claim) =>
      claim.type === 'citationRequired' || claim.type === 'currentEvents',
  );

  if (citationRequiredClaims.length > 0) {
    score -= citationRequiredClaims.length * 0.2;
    factors.push(`${citationRequiredClaims.length} claims requiring citations`);
  }

  // Reduce confidence for numerical claims without context
  const numericalClaims = claims.filter(
    (claim) => claim.type === 'numericalClaims',
  );
  if (numericalClaims.length > 0) {
    score -= numericalClaims.length * 0.1;
    factors.push(`${numericalClaims.length} numerical claims without context`);
  }

  // Reduce confidence for very specific claims
  if (
    text.includes('exactly') ||
    text.includes('precisely') ||
    text.includes('definitely')
  ) {
    score -= 0.2;
    factors.push('overly specific language');
  }

  // Increase confidence for hedging language
  if (hasHedgingLanguage(text)) {
    score += 0.1;
    factors.push('contains hedging language');
  }

  // Ensure score is within bounds
  score = Math.max(0, Math.min(1, score));

  // Determine risk level
  let riskLevel: 'low' | 'medium' | 'high' | 'critical';
  if (score >= 0.8) {
    riskLevel = 'low';
  } else if (score >= 0.6) {
    riskLevel = 'medium';
  } else if (score >= 0.4) {
    riskLevel = 'high';
  } else {
    riskLevel = 'critical';
  }

  return { score, factors, riskLevel };
}

// LLM-as-judge verification function
async function verifyWithLLM(
  claim: string,
  context: string,
): Promise<{
  confidence: number;
  requiresCitation: boolean;
  isVerifiable: boolean;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  reasoning: string;
  suggestedHedging?: string;
  factCheckRequired: boolean;
}> {
  try {
    const verificationPrompt = `
You are a fact-checking expert. Analyze the following claim for potential hallucination:

Claim: "${claim}"
Context: "${context}"

Evaluate this claim and provide:
1. Confidence level (0-1) in factual accuracy
2. Whether it requires a specific citation
3. Whether it can be verified with external sources
4. Risk level of potential hallucination
5. Reasoning for your assessment
6. Suggested hedging language if confidence is low
7. Whether fact-checking is required

Respond with a JSON object matching this schema:
{
  "confidence": number (0-1),
  "requiresCitation": boolean,
  "isVerifiable": boolean,
  "riskLevel": "low" | "medium" | "high" | "critical",
  "reasoning": string,
  "suggestedHedging": string (optional),
  "factCheckRequired": boolean
}
`;

    const result = await generateObject({
      model: model,
      prompt: verificationPrompt,
      schema: verificationSchema,
    });

    return result.object;
  } catch (error) {
    // Fallback to basic heuristics if LLM verification fails
    console.warn('LLM verification failed, using fallback heuristics:', error);

    const hasHedging = hasHedgingLanguage(claim);
    const confidence = hasHedging ? 0.7 : 0.5;
    const riskLevel =
      confidence >= 0.8 ? 'low' : confidence >= 0.6 ? 'medium' : 'high';

    return {
      confidence,
      requiresCitation:
        claim.toLowerCase().includes('research') ||
        claim.toLowerCase().includes('study'),
      isVerifiable: true,
      riskLevel,
      reasoning: 'Fallback assessment based on hedging language presence',
      factCheckRequired: confidence < 0.7,
    };
  }
}

// Define the hallucination detection guardrail
const hallucinationDetectionGuardrail =
  defineOutputGuardrail<HallucinationDetectionMetadata>({
    name: 'hallucination-detection',
    description:
      'Detects potential hallucinations and enforces hedging for uncertain claims',
    execute: async (context) => {
      const { result } = context;

      // Extract text content
      let text = '';
      if ('text' in result) {
        text =
          typeof result.text === 'string' ? result.text : String(result.text);
      } else if ('object' in result && result.object) {
        text = JSON.stringify(result.object);
      } else if ('content' in result && Array.isArray(result.content)) {
        const content = result.content;
        text = content
          .filter(
            (item: unknown) =>
              (item as Record<string, unknown>).type === 'text' &&
              (item as Record<string, unknown>).text,
          )
          .map(
            (item: unknown) => (item as Record<string, unknown>).text as string,
          )
          .join('');
      }

      // Fallback: try to extract from any available property
      if (!text && typeof result === 'object') {
        text = JSON.stringify(result);
      }

      // Extract factual claims
      const claims = extractFactualClaims(text);

      if (claims.length === 0) {
        return {
          tripwireTriggered: false,
          metadata: {
            confidenceScore: 1,
            riskLevel: 'low',
            claimsFound: 0,
            claimsVerified: 0,
            verifications: [],
            factors: [],
            hedgingSuggestions: [],
            textLength: text.length,
            hasHedgingLanguage: hasHedgingLanguage(text),
            claims: [],
          },
        };
      }

      // Calculate initial confidence score
      const {
        score: initialScore,
        factors,
        riskLevel,
      } = calculateConfidenceScore(text, claims);

      // Verify claims with LLM-as-judge (sample a few for performance)
      const claimsToVerify = claims.slice(0, 3); // Limit to 3 for performance
      const verifications = await Promise.all(
        claimsToVerify.map((claim) => verifyWithLLM(claim.claim, text)),
      );

      // Calculate overall confidence based on LLM verifications
      const avgConfidence =
        verifications.reduce((sum, v) => sum + v.confidence, 0) /
        verifications.length;
      const finalScore = (initialScore + avgConfidence) / 2;

      // Determine if hallucination is detected
      const hallucinationDetected =
        finalScore < 0.7 || riskLevel === 'critical';

      if (hallucinationDetected) {
        // Generate hedging suggestions
        const hedgingSuggestions = verifications
          .map((v) => v.suggestedHedging)
          .filter((s): s is string => s != null);

        return {
          tripwireTriggered: true,
          message: `Potential hallucination detected (confidence: ${(finalScore * 100).toFixed(1)}%, risk: ${riskLevel}). ${claims.length} factual claims identified.`,
          severity:
            riskLevel === 'critical'
              ? 'high'
              : riskLevel === 'high'
                ? 'high'
                : 'medium',
          metadata: {
            confidenceScore: finalScore,
            riskLevel,
            claimsFound: claims.length,
            claimsVerified: claimsToVerify.length,
            verifications,
            factors,
            hedgingSuggestions,
            textLength: text.length,
            hasHedgingLanguage: hasHedgingLanguage(text),
            claims: claims.map((claim) => ({
              type: claim.type,
              claim:
                claim.claim.slice(0, 100) +
                (claim.claim.length > 100 ? '...' : ''),
              position: claim.position,
            })),
          },
        };
      }

      return {
        tripwireTriggered: false,
        metadata: {
          confidenceScore: finalScore,
          riskLevel,
          claimsFound: claims.length,
          claimsVerified: claimsToVerify.length,
          verifications,
          factors,
          textLength: text.length,
          hasHedgingLanguage: hasHedgingLanguage(text),
        },
      };
    },
  });

console.log('🛡️  Hallucination Detection Example\n');

// Create a protected model with hallucination detection
const protectedModel = withGuardrails(model, {
  outputGuardrails: [hallucinationDetectionGuardrail],
  throwOnBlocked: true,
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('❌ Hallucination detected:', result?.message);
    if (result?.metadata) {
      console.log(
        '   Confidence:',
        typeof result.metadata === 'object' &&
          result.metadata &&
          'confidenceScore' in result.metadata &&
          typeof result.metadata.confidenceScore === 'number'
          ? ((result.metadata.confidenceScore as number) * 100).toFixed(1) + '%'
          : '0%',
      );
      console.log('   Risk Level:', result.metadata.riskLevel);
      console.log('   Claims Found:', result.metadata.claimsFound);
      if (
        typeof result.metadata === 'object' &&
        result.metadata &&
        'hedgingSuggestions' in result.metadata &&
        Array.isArray(result.metadata.hedgingSuggestions) &&
        (result.metadata.hedgingSuggestions as unknown[]).length > 0
      ) {
        console.log(
          '   Hedging Suggestions:',
          typeof result.metadata === 'object' &&
            result.metadata &&
            'hedgingSuggestions' in result.metadata &&
            Array.isArray(result.metadata.hedgingSuggestions)
            ? (result.metadata.hedgingSuggestions as string[]).slice(0, 2)
            : [],
        );
      }
    }
  },
});

// Test 1: Safe, well-hedged response
console.log('Test 1: Safe, well-hedged response (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Explain what artificial intelligence is, using hedging language for uncertain claims.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: High-confidence factual claims without citations
console.log(
  'Test 2: High-confidence factual claims without citations (should be blocked)',
);
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Provide specific statistics about AI adoption rates in 2024 with exact numbers and percentages.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Claims requiring citations
console.log('Test 3: Claims requiring citations (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Cite specific research studies about the effectiveness of machine learning algorithms.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 4: Current events claims
console.log('Test 4: Current events claims (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Tell me about the latest AI developments that happened this week.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 5: Numerical claims without context
console.log('Test 5: Numerical claims without context (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Give me exact statistics about the number of AI companies founded in 2023.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 6: Overly specific claims
console.log('Test 6: Overly specific claims (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Tell me exactly what percentage of Fortune 500 companies use AI, with precise numbers.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 7: Well-hedged response with qualifiers
console.log('Test 7: Well-hedged response with qualifiers (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Discuss AI trends, using words like "may", "might", "possibly", and "suggests" for uncertain information.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 8: Warning mode with hedging suggestions
console.log('Test 8: Warning mode with hedging suggestions');
const warningModel = withGuardrails(model, {
  outputGuardrails: [hallucinationDetectionGuardrail],
  throwOnBlocked: false,
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Warning:', result?.message);
    if (
      result &&
      result.metadata &&
      typeof result.metadata === 'object' &&
      'hedgingSuggestions' in result.metadata &&
      Array.isArray(result.metadata.hedgingSuggestions) &&
      (result.metadata.hedgingSuggestions as unknown[]).length > 0
    ) {
      console.log(
        '   Suggested hedging:',
        result.metadata &&
          typeof result.metadata === 'object' &&
          'hedgingSuggestions' in result.metadata &&
          Array.isArray(result.metadata.hedgingSuggestions)
          ? (result.metadata.hedgingSuggestions as string[])[0]
          : 'No suggestion available',
      );
    }
  },
});

try {
  const result = await generateText({
    model: warningModel,
    prompt:
      'Provide specific data about AI investment trends without hedging language.',
  });
  console.log(
    '✅ Proceeded with warning:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Unexpected error:', (error as Error).message + '\n');
}

// Test 9: Edge case - legitimate specific information
console.log('Test 9: Legitimate specific information (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Explain the basic concepts of machine learning in general terms.',
  });
  console.log('✅ Success (legitimate):', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

console.log('🎯 Hallucination detection guardrail demonstration complete!');
console.log('\nKey Features:');
console.log('• LLM-as-judge verification');
console.log('• Fact-checking pattern detection');
console.log('• Confidence scoring');
console.log('• Forced hedging for uncertain claims');
console.log('• Citation requirement detection');
console.log('• Numerical claim validation');
console.log('• Current events verification');
console.log('• Hedging language detection');
console.log('• Configurable confidence thresholds');
console.log('• Detailed metadata for analysis');
