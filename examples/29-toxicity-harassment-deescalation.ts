/**
 * Toxicity & Harassment De-escalation Example
 *
 * Demonstrates how to implement toxic content detection, harassment prevention,
 * de-escalation strategies, and safe response generation. This is critical for
 * maintaining safe user interactions and preventing harmful content from escalating
 * into more serious issues.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineInputGuardrail,
  defineOutputGuardrail,
  wrapWithInputGuardrails,
  wrapWithOutputGuardrails,
} from '../src/guardrails';
import { extractTextContent } from '../src/guardrails/input';
import { extractContent } from '../src/guardrails/output';

// Define toxicity categories and their detection patterns
const TOXICITY_CATEGORIES = {
  // Hate speech and discrimination
  hateSpeech: {
    patterns: [
      /hate\s*speech|discrimination|racism|sexism|homophobia|transphobia|antisemitism|islamophobia/gi,
      /white\s*supremacy|neo\s*nazi|fascist|extremist|supremacist/gi,
      /kill\s*all|exterminate|genocide|ethnic\s*cleansing|purge/gi,
      /inferior|superior\s*race|master\s*race|racial\s*purity/gi,
    ],
    severity: 'high',
    deEscalationStrategy: 'redirect',
    responseTemplate:
      "I understand you may be frustrated, but I cannot engage with discriminatory content. Let's focus on constructive dialogue.",
  },

  // Harassment and bullying
  harassment: {
    patterns: [
      /harass|bully|stalk|intimidate|threaten|menace/gi,
      /you\s*are\s*(stupid|idiot|moron|dumb|worthless|useless)/gi,
      /go\s*kill\s*yourself|kill\s*yourself|commit\s*suicide/gi,
      /you\s*should\s*die|hope\s*you\s*die|wish\s*you\s*were\s*dead/gi,
      /shut\s*up|shut\s*your\s*mouth|be\s*quiet/gi,
    ],
    severity: 'high',
    deEscalationStrategy: 'empathize',
    responseTemplate:
      "I hear that you're upset, but personal attacks aren't helpful. I'm here to help if you'd like to discuss the actual issue.",
  },

  // Threats and violence
  threats: {
    patterns: [
      /threat|threaten|violence|assault|attack|harm/gi,
      /i\s*will\s*kill|i\s*will\s*hurt|i\s*will\s*attack/gi,
      /you\s*will\s*pay|you\s*will\s*suffer|you\s*will\s*regret/gi,
      /watch\s*your\s*back|sleep\s*with\s*one\s*eye\s*open/gi,
      /i\s*hope\s*you\s*get\s*hurt|i\s*want\s*you\s*to\s*suffer/gi,
    ],
    severity: 'critical',
    deEscalationStrategy: 'safety',
    responseTemplate:
      "I'm concerned about the threatening language. If you're in crisis, please contact a crisis helpline. I'm here to help with constructive dialogue.",
  },

  // Sexual harassment
  sexualHarassment: {
    patterns: [
      /sexual|inappropriate|lewd|vulgar|obscene/gi,
      /send\s*nudes|nude\s*pics|sexy\s*pictures/gi,
      /sexual\s*comments|inappropriate\s*remarks/gi,
      /you\s*look\s*sexy|you\s*are\s*attractive/gi,
      /sexual\s*advances|unwanted\s*attention/gi,
    ],
    severity: 'high',
    deEscalationStrategy: 'boundary',
    responseTemplate:
      "I'm an AI assistant designed to help with information and tasks. I cannot engage with inappropriate or sexual content. How can I help you with your actual question?",
  },

  // Trolling and provocation
  trolling: {
    patterns: [
      /troll|provoke|trigger|bait|annoy|irritate/gi,
      /just\s*kidding|it's\s*a\s*joke|don't\s*take\s*it\s*seriously/gi,
      /snowflake|triggered|offended|sensitive/gi,
      /can't\s*take\s*a\s*joke|too\s*sensitive|easily\s*offended/gi,
    ],
    severity: 'medium',
    deEscalationStrategy: 'ignore',
    responseTemplate:
      "I'm here to help with genuine questions and tasks. If you have a real question, I'd be happy to assist.",
  },

  // Aggressive language
  aggressive: {
    patterns: [
      /angry|furious|rage|outrage|fuming|livid/gi,
      /screw\s*you|fuck\s*you|damn\s*you|curse\s*you/gi,
      /i\s*hate\s*you|i\s*despise\s*you|i\s*loathe\s*you/gi,
      /you\s*suck|you're\s*terrible|you're\s*awful/gi,
      /get\s*lost|go\s*away|leave\s*me\s*alone/gi,
    ],
    severity: 'medium',
    deEscalationStrategy: 'calm',
    responseTemplate:
      "I understand you're frustrated. Let's take a step back and address the actual issue you're facing. I'm here to help.",
  },

  // Manipulation and gaslighting
  manipulation: {
    patterns: [
      /gaslight|manipulate|control|coerce|pressure/gi,
      /you\s*didn't\s*say\s*that|that\s*never\s*happened/gi,
      /you're\s*imagining\s*things|you're\s*overreacting/gi,
      /you're\s*too\s*sensitive|you're\s*being\s*dramatic/gi,
      /if\s*you\s*loved\s*me|if\s*you\s*cared/gi,
    ],
    severity: 'high',
    deEscalationStrategy: 'validate',
    responseTemplate:
      "I want to understand your perspective. Let's discuss this openly and honestly without manipulation.",
  },

  // Spam and repetitive content
  spam: {
    patterns: [
      /spam|repetitive|repeated|same\s*message/gi,
      /buy\s*now|click\s*here|limited\s*time/gi,
      /make\s*money|get\s*rich|quick\s*cash/gi,
      /free\s*offer|special\s*deal|exclusive/gi,
    ],
    severity: 'low',
    deEscalationStrategy: 'redirect',
    responseTemplate:
      "I'm here to help with genuine questions and tasks. How can I assist you with your actual needs?",
  },
};

// Define de-escalation strategies
const DE_ESCALATION_STRATEGIES = {
  redirect: {
    name: 'Redirect',
    description: 'Redirect the conversation to constructive topics',
    techniques: [
      'Acknowledge the emotion without engaging with the content',
      'Offer to help with the underlying issue',
      'Suggest alternative approaches',
      'Focus on problem-solving',
    ],
  },

  empathize: {
    name: 'Empathize',
    description: 'Show understanding while maintaining boundaries',
    techniques: [
      "Acknowledge the person's feelings",
      'Validate their experience without condoning harmful behavior',
      'Offer support for the underlying issue',
      'Maintain professional boundaries',
    ],
  },

  safety: {
    name: 'Safety First',
    description: 'Prioritize safety and crisis intervention',
    techniques: [
      'Assess immediate safety concerns',
      'Provide crisis resources if needed',
      'Maintain calm and professional demeanor',
      'Escalate to human review if necessary',
    ],
  },

  boundary: {
    name: 'Set Boundaries',
    description: 'Clearly establish and maintain professional boundaries',
    techniques: [
      'Clearly state what is not acceptable',
      'Redirect to appropriate topics',
      'Maintain professional distance',
      'Offer alternative assistance',
    ],
  },

  ignore: {
    name: 'Ignore Provocation',
    description: 'Refuse to engage with trolling or provocation',
    techniques: [
      "Don't respond to obvious trolling",
      'Focus on genuine questions',
      'Maintain professional composure',
      'Redirect to constructive dialogue',
    ],
  },

  calm: {
    name: 'Calm and De-escalate',
    description: 'Use calming techniques to reduce aggression',
    techniques: [
      'Use calm, measured language',
      'Acknowledge emotions without escalation',
      'Offer time to cool down',
      'Focus on solutions rather than conflict',
    ],
  },

  validate: {
    name: 'Validate Feelings',
    description: 'Validate emotions while addressing manipulation',
    techniques: [
      'Acknowledge legitimate concerns',
      'Address manipulation tactics directly',
      'Encourage honest communication',
      'Maintain objective perspective',
    ],
  },
};

// Define toxicity thresholds
const TOXICITY_THRESHOLDS = {
  low: 0.3,
  medium: 0.6,
  high: 0.8,
  critical: 0.9,
  maxConsecutiveViolations: 3,
  cooldownPeriod: 300, // seconds
  requireHumanReview: 0.85,
  autoBlockThreshold: 0.95,
};

// Define safe response templates
const SAFE_RESPONSE_TEMPLATES = {
  general: [
    "I'm here to help with your questions and tasks. How can I assist you?",
    "I understand you may be frustrated. Let's work together to find a solution.",
    "I'm designed to be helpful and respectful. How can I support you today?",
    'I want to help you with your actual needs. What would you like to discuss?',
  ],

  crisis: [
    "If you're in crisis, please contact a crisis helpline immediately.",
    'Your safety is important. Please reach out to a mental health professional.',
    "If you're having thoughts of self-harm, please call a crisis hotline.",
    "I'm concerned about your wellbeing. Please seek professional help.",
  ],

  boundary: [
    "I'm an AI assistant designed to help with information and tasks.",
    'I cannot engage with inappropriate or harmful content.',
    "I'm here to help with constructive dialogue and problem-solving.",
    "Let's focus on how I can assist you with your actual needs.",
  ],
};

// Detect toxicity in text
function detectToxicity(text: string): {
  toxicityScore: number;
  categories: string[];
  violations: Array<{
    category: string;
    severity: string;
    matches: string[];
    score: number;
  }>;
  overallSeverity: 'low' | 'medium' | 'high' | 'critical';
  deEscalationStrategy: string;
} {
  const violations: Array<{
    category: string;
    severity: string;
    matches: string[];
    score: number;
  }> = [];
  let totalScore = 0;
  let maxSeverity = 'low' as 'low' | 'medium' | 'high' | 'critical';

  for (const [category, config] of Object.entries(TOXICITY_CATEGORIES)) {
    const matches: string[] = [];

    for (const pattern of config.patterns) {
      const found = text.match(pattern);
      if (found) {
        matches.push(...found);
      }
    }

    if (matches.length > 0) {
      // Calculate category score based on match count and severity
      const severityWeight =
        config.severity === 'critical'
          ? 4
          : config.severity === 'high'
            ? 3
            : config.severity === 'medium'
              ? 2
              : 1;

      const categoryScore = (matches.length * severityWeight) / text.length;
      totalScore += categoryScore;

      violations.push({
        category,
        severity: config.severity,
        matches: [...new Set(matches)], // Remove duplicates
        score: categoryScore,
      });

      // Update max severity
      if (
        config.severity === 'critical' ||
        (config.severity === 'high' && maxSeverity !== 'critical') ||
        (config.severity === 'medium' && maxSeverity === 'low')
      ) {
        maxSeverity = config.severity as 'low' | 'medium' | 'high' | 'critical';
      }
    }
  }

  // Determine de-escalation strategy based on highest severity violation
  let deEscalationStrategy = 'redirect';
  if (violations.length > 0) {
    let highestSeverityViolation = violations[0];
    for (let i = 1; i < violations.length; i++) {
      const current = violations[i];
      if (!current || !highestSeverityViolation) {
        continue;
      }
      const currentSeverity =
        TOXICITY_CATEGORIES[
          current.category as keyof typeof TOXICITY_CATEGORIES
        ].severity;
      const highestSeverity =
        TOXICITY_CATEGORIES[
          highestSeverityViolation.category as keyof typeof TOXICITY_CATEGORIES
        ].severity;

      if (
        currentSeverity === 'critical' ||
        (currentSeverity === 'high' && highestSeverity !== 'critical') ||
        (currentSeverity === 'medium' && highestSeverity === 'low')
      ) {
        highestSeverityViolation = current;
      }
    }
    if (highestSeverityViolation) {
      deEscalationStrategy =
        TOXICITY_CATEGORIES[
          highestSeverityViolation.category as keyof typeof TOXICITY_CATEGORIES
        ].deEscalationStrategy;
    }
  }

  return {
    toxicityScore: Math.min(totalScore, 1),
    categories: violations.map((v) => v.category),
    violations,
    overallSeverity: maxSeverity,
    deEscalationStrategy,
  };
}

// Generate safe response
function generateSafeResponse(
  toxicityAnalysis: ReturnType<typeof detectToxicity>,
): {
  response: string;
  strategy: string;
  escalationLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
} {
  const { toxicityScore, deEscalationStrategy, violations } = toxicityAnalysis;

  // Determine escalation level
  let escalationLevel: 'none' | 'low' | 'medium' | 'high' | 'critical' = 'none';
  if (toxicityScore >= TOXICITY_THRESHOLDS.critical) {
    escalationLevel = 'critical';
  } else if (toxicityScore >= TOXICITY_THRESHOLDS.high) {
    escalationLevel = 'high';
  } else if (toxicityScore >= TOXICITY_THRESHOLDS.medium) {
    escalationLevel = 'medium';
  } else if (toxicityScore >= TOXICITY_THRESHOLDS.low) {
    escalationLevel = 'low';
  }

  // Generate appropriate response based on strategy
  let response = '';
  const strategy =
    DE_ESCALATION_STRATEGIES[
      deEscalationStrategy as keyof typeof DE_ESCALATION_STRATEGIES
    ];

  if (escalationLevel === 'critical') {
    // Use crisis response for critical situations
    response =
      SAFE_RESPONSE_TEMPLATES.crisis[
        Math.floor(Math.random() * SAFE_RESPONSE_TEMPLATES.crisis.length)
      ] ||
      'I understand you may be in crisis. Please contact a crisis helpline for immediate support.';
  } else if (escalationLevel === 'high') {
    // Use boundary-setting response for high toxicity
    response =
      SAFE_RESPONSE_TEMPLATES.boundary[
        Math.floor(Math.random() * SAFE_RESPONSE_TEMPLATES.boundary.length)
      ] ||
      'I cannot engage with harmful content. How can I help you with a constructive question?';
  } else {
    // Use strategy-specific response
    const categoryConfig =
      violations.length > 0 && violations[0]
        ? TOXICITY_CATEGORIES[
            violations[0].category as keyof typeof TOXICITY_CATEGORIES
          ]
        : null;

    response =
      categoryConfig && categoryConfig.responseTemplate
        ? categoryConfig.responseTemplate
        : SAFE_RESPONSE_TEMPLATES.general[
            Math.floor(Math.random() * SAFE_RESPONSE_TEMPLATES.general.length)
          ] ||
          'I understand you may be frustrated. How can I help you with your question?';
  }

  return {
    response,
    strategy: strategy.name,
    escalationLevel,
  };
}

// Track user interaction history for escalation
const userInteractionHistory = new Map<
  string,
  {
    violations: Array<{
      timestamp: number;
      toxicityScore: number;
      severity: string;
    }>;
    lastViolation: number;
    consecutiveViolations: number;
  }
>();

// Check if user needs cooldown or escalation
function checkUserEscalation(
  userId: string,
  toxicityScore: number,
  severity: string,
): {
  needsCooldown: boolean;
  needsHumanReview: boolean;
  shouldBlock: boolean;
  cooldownRemaining: number;
} {
  const now = Date.now();
  const userHistory = userInteractionHistory.get(userId) || {
    violations: [],
    lastViolation: 0,
    consecutiveViolations: 0,
  };

  // Add current violation
  userHistory.violations.push({
    timestamp: now,
    toxicityScore,
    severity,
  });

  // Check for consecutive violations
  const recentViolations = userHistory.violations.filter(
    (v) => now - v.timestamp < TOXICITY_THRESHOLDS.cooldownPeriod * 1000,
  );

  userHistory.consecutiveViolations = recentViolations.length;
  userHistory.lastViolation = now;

  // Clean old violations
  userHistory.violations = userHistory.violations.filter(
    (v) => now - v.timestamp < TOXICITY_THRESHOLDS.cooldownPeriod * 1000,
  );

  userInteractionHistory.set(userId, userHistory);

  // Determine actions needed
  const needsCooldown =
    userHistory.consecutiveViolations >=
    TOXICITY_THRESHOLDS.maxConsecutiveViolations;
  const needsHumanReview =
    toxicityScore >= TOXICITY_THRESHOLDS.requireHumanReview;
  const shouldBlock = toxicityScore >= TOXICITY_THRESHOLDS.autoBlockThreshold;

  const cooldownRemaining = needsCooldown
    ? Math.max(
        0,
        TOXICITY_THRESHOLDS.cooldownPeriod -
          (now - userHistory.lastViolation) / 1000,
      )
    : 0;

  return {
    needsCooldown,
    needsHumanReview,
    shouldBlock,
    cooldownRemaining,
  };
}

// Define the input toxicity guardrail
const toxicityInputGuardrail = defineInputGuardrail<{
  toxicityScore: number;
  categories: string[];
  violations: Array<{
    category: string;
    severity: string;
    matches: string[];
    score: number;
  }>;
  overallSeverity: 'low' | 'medium' | 'high' | 'critical';
  deEscalationStrategy: string;
  safeResponse: string;
  escalationLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
  needsCooldown: boolean;
  needsHumanReview: boolean;
  shouldBlock: boolean;
  cooldownRemaining: number;
}>({
  name: 'toxicity-input',
  description:
    'Detects and de-escalates toxic content and harassment in user input',
  execute: async (context) => {
    const { prompt } = extractTextContent(context);

    // Detect toxicity
    const toxicityAnalysis = detectToxicity(prompt);

    if (toxicityAnalysis.toxicityScore >= TOXICITY_THRESHOLDS.low) {
      // Generate safe response
      const safeResponse = generateSafeResponse(toxicityAnalysis);

      // Check user escalation (using a simple user ID for demo)
      const userId = 'demo-user';
      const escalation = checkUserEscalation(
        userId,
        toxicityAnalysis.toxicityScore,
        toxicityAnalysis.overallSeverity,
      );

      return {
        tripwireTriggered: true,
        message: `Toxic content detected (score: ${toxicityAnalysis.toxicityScore.toFixed(2)}). Using ${safeResponse.strategy} strategy.`,
        severity: toxicityAnalysis.overallSeverity,
        suggestion: `Consider using respectful language. ${safeResponse.response}`,
        metadata: {
          toxicityScore: toxicityAnalysis.toxicityScore,
          categories: toxicityAnalysis.categories,
          violations: toxicityAnalysis.violations,
          overallSeverity: toxicityAnalysis.overallSeverity,
          deEscalationStrategy: toxicityAnalysis.deEscalationStrategy,
          safeResponse: safeResponse.response,
          escalationLevel: safeResponse.escalationLevel,
          needsCooldown: escalation.needsCooldown,
          needsHumanReview: escalation.needsHumanReview,
          shouldBlock: escalation.shouldBlock,
          cooldownRemaining: escalation.cooldownRemaining,
        },
        // Note: Safe response applied but original prompt preserved for processing
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        toxicityScore: toxicityAnalysis.toxicityScore,
        categories: toxicityAnalysis.categories,
        violations: toxicityAnalysis.violations,
        overallSeverity: toxicityAnalysis.overallSeverity,
        deEscalationStrategy: toxicityAnalysis.deEscalationStrategy,
        safeResponse: '',
        escalationLevel: 'none',
        needsCooldown: false,
        needsHumanReview: false,
        shouldBlock: false,
        cooldownRemaining: 0,
      },
    };
  },
});

// Define the output toxicity guardrail
const toxicityOutputGuardrail = defineOutputGuardrail<{
  toxicityScore: number;
  categories: string[];
  violations: Array<{
    category: string;
    severity: string;
    matches: string[];
    score: number;
  }>;
  overallSeverity: 'low' | 'medium' | 'high' | 'critical';
  deEscalationStrategy: string;
  safeResponse: string;
  escalationLevel: 'none' | 'low' | 'medium' | 'high' | 'critical';
}>({
  name: 'toxicity-output',
  description: 'Ensures AI output is safe and non-toxic',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    // Detect toxicity in output
    const toxicityAnalysis = detectToxicity(text);

    if (toxicityAnalysis.toxicityScore >= TOXICITY_THRESHOLDS.low) {
      // Generate safe response
      const safeResponse = generateSafeResponse(toxicityAnalysis);

      return {
        tripwireTriggered: true,
        message: `Output contains toxic content (score: ${toxicityAnalysis.toxicityScore.toFixed(2)}). Replacing with safe response.`,
        severity: toxicityAnalysis.overallSeverity,
        suggestion: `AI output should be safe and respectful. Using ${safeResponse.strategy} strategy.`,
        metadata: {
          toxicityScore: toxicityAnalysis.toxicityScore,
          categories: toxicityAnalysis.categories,
          violations: toxicityAnalysis.violations,
          overallSeverity: toxicityAnalysis.overallSeverity,
          deEscalationStrategy: toxicityAnalysis.deEscalationStrategy,
          safeResponse: safeResponse.response,
          escalationLevel: safeResponse.escalationLevel,
        },
        // Note: Safe response applied but original output preserved for processing
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        toxicityScore: toxicityAnalysis.toxicityScore,
        categories: toxicityAnalysis.categories,
        violations: toxicityAnalysis.violations,
        overallSeverity: toxicityAnalysis.overallSeverity,
        deEscalationStrategy: toxicityAnalysis.deEscalationStrategy,
        safeResponse: '',
        escalationLevel: 'none',
      },
    };
  },
});

console.log('🛡️  Toxicity & Harassment De-escalation Example\n');

// Create a protected model with toxicity detection
const protectedModel = wrapWithOutputGuardrails(
  wrapWithInputGuardrails(model, [toxicityInputGuardrail], {
    throwOnBlocked: false,
    onInputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('⚠️  Toxicity detected:', result?.message);
      if (result?.metadata) {
        const metadata = result.metadata;
        console.log('   Toxicity Score:', metadata.toxicityScore?.toFixed(2));
        console.log(
          '   Categories:',
          metadata.categories?.join(', ') || 'None',
        );
        console.log('   Severity:', metadata.overallSeverity);
        console.log('   Strategy:', metadata.deEscalationStrategy);
        console.log('   Escalation Level:', metadata.escalationLevel);
        if (metadata.needsCooldown) {
          console.log(
            '   Cooldown Required:',
            metadata.cooldownRemaining?.toFixed(0) + 's remaining',
          );
        }
        if (metadata.needsHumanReview) {
          console.log('   Human Review Required');
        }
        if (metadata.shouldBlock) {
          console.log('   User Should Be Blocked');
        }
      }
    },
  }),
  [toxicityOutputGuardrail],
  {
    throwOnBlocked: false,
    onOutputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('⚠️  Output toxicity detected:', result?.message);
      if (result?.metadata) {
        const metadata = result.metadata;
        console.log('   Toxicity Score:', metadata.toxicityScore?.toFixed(2));
        console.log(
          '   Categories:',
          metadata.categories?.join(', ') || 'None',
        );
        console.log('   Severity:', metadata.overallSeverity);
        console.log('   Strategy:', metadata.deEscalationStrategy);
        console.log('   Escalation Level:', metadata.escalationLevel);
      }
    },
  },
);

// Test 1: Safe content (should pass)
console.log('Test 1: Safe content (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Can you help me with a programming question?',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Hate speech (should be de-escalated)
console.log('Test 2: Hate speech (should be de-escalated)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'I hate all people of a certain race and want to discriminate against them.',
  });
  console.log(
    '✅ Success with de-escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 3: Harassment (should be de-escalated)
console.log('Test 3: Harassment (should be de-escalated)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'You are stupid and worthless. Go kill yourself.',
  });
  console.log(
    '✅ Success with de-escalation:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 4: Threats (should trigger safety response)
console.log('Test 4: Threats (should trigger safety response)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'I will kill you and your family. You will pay for this.',
  });
  console.log(
    '✅ Success with safety response:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 5: Sexual harassment (should set boundaries)
console.log('Test 5: Sexual harassment (should set boundaries)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: "Send me nude pictures and let's talk about sexual things.",
  });
  console.log(
    '✅ Success with boundary setting:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 6: Trolling (should be ignored)
console.log('Test 6: Trolling (should be ignored)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: "You're just a snowflake who can't take a joke. Triggered much?",
  });
  console.log(
    '✅ Success with trolling response:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 7: Aggressive language (should be calmed)
console.log('Test 7: Aggressive language (should be calmed)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: "I'm so angry at you! You suck and I hate you!",
  });
  console.log(
    '✅ Success with calming response:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 8: Manipulation (should validate)
console.log('Test 8: Manipulation (should validate)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      "You didn't say that. You're imagining things. You're being too sensitive.",
  });
  console.log(
    '✅ Success with validation response:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 9: Spam (should redirect)
console.log('Test 9: Spam (should redirect)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'BUY NOW! LIMITED TIME OFFER! MAKE MONEY FAST! CLICK HERE!',
  });
  console.log(
    '✅ Success with redirect response:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 10: Escalation tracking
console.log('Test 10: Escalation tracking');
const testPrompts = ['You are stupid', 'I hate you', 'Go die'];

for (const [i, prompt] of testPrompts.entries()) {
  const toxicityAnalysis = detectToxicity(prompt);
  const userId = 'test-user';
  const escalation = checkUserEscalation(
    userId,
    toxicityAnalysis.toxicityScore,
    toxicityAnalysis.overallSeverity,
  );

  console.log(`Prompt ${i + 1}: "${prompt}"`);
  console.log(`  Toxicity Score: ${toxicityAnalysis.toxicityScore.toFixed(2)}`);
  console.log(`  Severity: ${toxicityAnalysis.overallSeverity}`);
  console.log(
    `  Consecutive Violations: ${escalation.needsCooldown ? 'Yes' : 'No'}`,
  );
  console.log(
    `  Human Review: ${escalation.needsHumanReview ? 'Required' : 'Not needed'}`,
  );
  console.log(`  Should Block: ${escalation.shouldBlock ? 'Yes' : 'No'}`);
  console.log('');
}

console.log(
  '🎯 Toxicity & harassment de-escalation guardrail demonstration complete!',
);
console.log('\nKey Features:');
console.log('• Toxic content detection');
console.log('• Harassment prevention');
console.log('• De-escalation strategies');
console.log('• Safe response generation');
console.log('• User escalation tracking');
console.log('• Cooldown management');
console.log('• Human review escalation');
console.log('• Crisis intervention');
console.log('• Boundary setting');
console.log('• Multi-category toxicity detection');
