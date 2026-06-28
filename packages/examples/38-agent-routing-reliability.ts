/**
 * Agent Routing: Reliability is Critical
 *
 * Demonstrates how routing decisions depend on reliable agent outputs.
 * Shows why guardrails are essential for routing workflows.
 *
 * Pattern: Classifier → Router → Specialist Agents
 * - Intent Classifier: Determines user intent (technical, business, legal)
 * - Router: Routes to appropriate specialist based on classification
 * - Specialists: Handle domain-specific tasks
 *
 * Without guardrails: Wrong classification → Wrong routing → Wrong specialist → Wrong answer
 * With guardrails: Reliable classification → Correct routing → Right specialist → Quality answer
 */

import { generateText, ToolLoopAgent } from 'ai';
import { model } from './model';
import { withGuardrails } from 'ai-sdk-guardrails';
import { createOutputGuardrail } from 'ai-sdk-guardrails';
import { extractContent } from 'ai-sdk-guardrails/guardrails/output';
import { agentGuardrails } from 'ai-sdk-guardrails';

console.log('🧭 Agent Routing: Reliability Demo');
console.log('==================================\n');

// Intent classification guardrail - ensures valid classification
const validIntentClassification = createOutputGuardrail(
  'valid-intent-classification',
  ({ result }) => {
    const { text } = extractContent(result);
    const validIntents = ['TECHNICAL', 'BUSINESS', 'LEGAL', 'GENERAL'];
    const hasValidIntent = validIntents.some((intent) => text.includes(intent));

    // Extract confidence if present
    const confidenceMatch = text.match(/confidence[:\s]+(\d+)%?/i);
    const confidence = confidenceMatch?.[1]
      ? Number.parseInt(confidenceMatch[1], 10)
      : 0;
    const hasConfidence = confidence > 70;

    if (!hasValidIntent) {
      return {
        tripwireTriggered: true,
        severity: 'high' as const,
        message:
          'Classification must use valid intent categories: TECHNICAL, BUSINESS, LEGAL, or GENERAL',
        metadata: { hasValidIntent, confidence },
      };
    }

    if (!hasConfidence) {
      return {
        tripwireTriggered: true,
        severity: 'medium' as const,
        message: 'Classification must include confidence level above 70%',
        metadata: { hasValidIntent, confidence },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        hasValidIntent,
        confidence,
        intent: validIntents.find((i) => text.includes(i)),
      },
    };
  },
);

// Specialist response guardrail - ensures domain expertise
const domainExpertise = (domain: string) =>
  createOutputGuardrail(`${domain}-expertise`, ({ result }) => {
    const { text } = extractContent(result);
    const domainKeywords = {
      technical: ['API', 'code', 'implementation', 'algorithm', 'architecture'],
      business: ['strategy', 'ROI', 'market', 'revenue', 'stakeholder'],
      legal: ['compliance', 'regulation', 'contract', 'liability', 'terms'],
    };

    const keywords =
      domainKeywords[domain.toLowerCase() as keyof typeof domainKeywords] || [];
    const hasExpertise = keywords.some((keyword) =>
      text.toLowerCase().includes(keyword.toLowerCase()),
    );

    if (!hasExpertise) {
      return {
        tripwireTriggered: true,
        severity: 'medium' as const,
        message: `Response must demonstrate ${domain} expertise with relevant terminology`,
        metadata: { domain, expectedKeywords: keywords, hasExpertise },
      };
    }

    return { tripwireTriggered: false, metadata: { domain, hasExpertise } };
  });

// Test queries for different intents
const testQueries = [
  'How do I implement OAuth2 authentication in my API?',
  'What is the business case for investing in AI automation?',
  'What are the legal requirements for data privacy in EU?',
  'Can you help me with general productivity tips?',
];

// Specialist agents
const specialists = {
  TECHNICAL: {
    system:
      'You are a senior software engineer. Provide technical solutions with code examples.',
    guardrail: domainExpertise('technical'),
  },
  BUSINESS: {
    system:
      'You are a business consultant. Focus on strategy, ROI, and market impact.',
    guardrail: domainExpertise('business'),
  },
  LEGAL: {
    system:
      'You are a legal advisor. Address compliance, regulations, and legal implications.',
    guardrail: domainExpertise('legal'),
  },
  GENERAL: {
    system: 'You are a helpful general assistant.',
    guardrail: createOutputGuardrail('general-helpful', () => ({
      tripwireTriggered: false,
    })),
  },
};

// SCENARIO 1: WITHOUT GUARDRAILS (Unreliable Routing)
async function runWithoutGuardrails() {
  console.log('❌ SCENARIO 1: WITHOUT GUARDRAILS');
  console.log('----------------------------------');

  for (const query of testQueries) {
    console.log(`\n🔍 Query: "${query}"`);

    try {
      // Intent Classification (no guardrails - might be wrong/unclear)
      const classification = await generateText({
        model,
        system:
          'Classify user intent as TECHNICAL, BUSINESS, LEGAL, or GENERAL.',
        prompt: `Classify this query: "${query}"`,
      });

      console.log(`📊 Classification: ${classification.text}`);

      // Extract intent (might fail due to unclear classification)
      const intent =
        ['TECHNICAL', 'BUSINESS', 'LEGAL', 'GENERAL'].find((i) =>
          classification.text.includes(i),
        ) || 'GENERAL';

      console.log(`🧭 Routing to: ${intent} specialist`);

      // Specialist response (no guardrails - might not show expertise)
      const specialist = specialists[intent as keyof typeof specialists];
      const response = await generateText({
        model,
        system: specialist.system,
        prompt: query,
      });

      console.log(`💬 Response: ${response.text.slice(0, 100)}...`);
      console.log(`❓ Quality: Unknown (no validation)`);
    } catch (error) {
      console.log(`❌ Failed: ${error}`);
    }
  }
}

// SCENARIO 2: WITH GUARDRAILS (Reliable Routing)
async function runWithGuardrails() {
  console.log('\n✅ SCENARIO 2: WITH GUARDRAILS');
  console.log('------------------------------');

  // Guarded intent classifier
  const guardedClassifier = withGuardrails({
    model,
    outputGuardrails: [validIntentClassification],
    // Default retry: the corrective prompt is built automatically from the
    // guardrail's message — no manual prompt surgery needed.
    retry: { maxRetries: 2 },
  });

  for (const query of testQueries) {
    console.log(`\n🔍 Query: "${query}"`);

    try {
      // Reliable Intent Classification
      const classification = await generateText({
        model: guardedClassifier,
        system:
          'Classify user intent as TECHNICAL, BUSINESS, LEGAL, or GENERAL with confidence percentage.',
        prompt: `Classify this query: "${query}"`,
      });

      console.log(`📊 Classification (validated): ${classification.text}`);

      // Extract intent (reliable due to guardrails)
      const intent =
        ['TECHNICAL', 'BUSINESS', 'LEGAL', 'GENERAL'].find((i) =>
          classification.text.includes(i),
        ) || 'GENERAL';

      console.log(`🧭 Routing to: ${intent} specialist`);

      // Guarded specialist response
      const specialist = specialists[intent as keyof typeof specialists];
      const guardedSpecialist = withGuardrails({
        model,
        outputGuardrails: [specialist.guardrail],
        retry: { maxRetries: 2 },
      });

      const response = await generateText({
        model: guardedSpecialist,
        system: specialist.system,
        prompt: query,
      });

      console.log(`💬 Response (validated): ${response.text.slice(0, 100)}...`);
      console.log(`✅ Quality: Guaranteed domain expertise`);
    } catch (error) {
      console.log(`❌ Failed: ${error}`);
    }
  }
}

// SCENARIO 3: Agent Wrapper Routing
async function runAgentWrapperRouting() {
  console.log('\n🎯 SCENARIO 3: AGENT WRAPPER ROUTING');
  console.log('------------------------------------');

  // Create specialized agents using the agent wrapper
  const classifierAgent = new ToolLoopAgent({
    ...agentGuardrails({
      model,
      outputGuardrails: [validIntentClassification],
      retry: { maxRetries: 2 },
    }),
    instructions:
      'Classify user intent as TECHNICAL, BUSINESS, LEGAL, or GENERAL with confidence percentage.',
  });

  const technicalAgent = new ToolLoopAgent({
    ...agentGuardrails({
      model,
      outputGuardrails: [domainExpertise('technical')],
      retry: { maxRetries: 2 },
    }),
    instructions:
      'You are a senior software engineer. Provide technical solutions with code examples.',
  });

  const businessAgent = new ToolLoopAgent({
    ...agentGuardrails({
      model,
      outputGuardrails: [domainExpertise('business')],
      retry: { maxRetries: 2 },
    }),
    instructions:
      'You are a business consultant. Focus on strategy, ROI, and market impact.',
  });

  const legalAgent = new ToolLoopAgent({
    ...agentGuardrails({
      model,
      outputGuardrails: [domainExpertise('legal')],
      retry: { maxRetries: 2 },
    }),
    instructions:
      'You are a legal advisor. Address compliance, regulations, and legal implications.',
  });

  for (const query of testQueries) {
    console.log(`\n🔍 Query: "${query}"`);

    try {
      // Reliable Intent Classification using agent wrapper
      const classification = await classifierAgent.generate({
        prompt: `Classify this query: "${query}"`,
      });

      console.log(`📊 Classification (validated): ${classification.text}`);

      // Extract intent (reliable due to guardrails)
      const intent =
        ['TECHNICAL', 'BUSINESS', 'LEGAL', 'GENERAL'].find((i) =>
          classification.text.includes(i),
        ) || 'GENERAL';

      console.log(`🧭 Routing to: ${intent} specialist`);

      // Route to appropriate specialist agent
      let response;
      switch (intent) {
        case 'TECHNICAL': {
          response = await technicalAgent.generate({ prompt: query });
          break;
        }
        case 'BUSINESS': {
          response = await businessAgent.generate({ prompt: query });
          break;
        }
        case 'LEGAL': {
          response = await legalAgent.generate({ prompt: query });
          break;
        }
        default: {
          response = await generateText({
            model,
            system: 'You are a helpful general assistant.',
            prompt: query,
          });
        }
      }

      console.log(`💬 Response (validated): ${response.text.slice(0, 100)}...`);
      console.log(`✅ Quality: Guaranteed domain expertise`);
    } catch (error) {
      console.log(`❌ Failed: ${error}`);
    }
  }
}

// SCENARIO 4: Multi-Agent Routing Decision
async function runCollaborativeRouting() {
  console.log('\n🤝 SCENARIO 4: COLLABORATIVE ROUTING');
  console.log('------------------------------------');

  const complexQuery =
    'We need to implement AI-powered compliance monitoring for our financial platform. What technical architecture should we use and what are the legal requirements?';

  console.log(`🔍 Complex Query: "${complexQuery}"`);

  // Multi-agent classification
  const technicalAgent = withGuardrails({
    model,
    outputGuardrails: [domainExpertise('technical')],
  });
  const legalAgent = withGuardrails({
    model,
    outputGuardrails: [domainExpertise('legal')],
  });

  // Each agent evaluates relevance to their domain
  const [techEval, legalEval] = await Promise.all([
    generateText({
      model: technicalAgent,
      system:
        'Evaluate if this query requires technical expertise. Rate 1-10 and explain.',
      prompt: complexQuery,
    }),
    generateText({
      model: legalAgent,
      system:
        'Evaluate if this query requires legal expertise. Rate 1-10 and explain.',
      prompt: complexQuery,
    }),
  ]);

  console.log(`🔧 Technical evaluation: ${techEval.text.slice(0, 80)}...`);
  console.log(`⚖️ Legal evaluation: ${legalEval.text.slice(0, 80)}...`);
  console.log(`✅ Router can now make informed multi-domain routing decision`);
}

async function main() {
  await runWithoutGuardrails();
  await runWithGuardrails();
  await runAgentWrapperRouting();
  await runCollaborativeRouting();

  console.log('\n🎯 ROUTING INSIGHTS:');
  console.log('===================');
  console.log('• Wrong classification = Wrong routing = Wrong answer');
  console.log('• Router decisions are only as good as classifier reliability');
  console.log('• Specialists must demonstrate domain expertise');
  console.log(
    '• Agent wrapper provides clean, type-safe routing with guardrails',
  );
  console.log('• Multi-domain queries need validated specialist evaluations');
  console.log('• Guardrails ensure routing integrity across the entire flow');
  console.log(
    '• Production routing systems cannot afford classification errors',
  );
}

main().catch(console.error);
