/**
 * Secret Leakage Scan Example
 *
 * Demonstrates how to scan outbound content for secrets, API keys, tokens,
 * and other sensitive information to prevent accidental data exposure.
 * This is critical for maintaining security and compliance.
 */

import { generateText } from 'ai';
import { model } from './model';
import {
  defineOutputGuardrail,
  wrapWithOutputGuardrails,
} from '../src/guardrails';
import { extractContent } from '../src/guardrails/output';

// Define types for secret leakage scan metadata
interface SecretLeakageMetadata extends Record<string, unknown> {
  totalSecrets?: number;
  secretsByType?: Record<
    string,
    Array<{
      type: string;
      value: string;
      position: { start: number; end: number };
      entropy?: number;
    }>
  >;
  secretTypes?: string[];
  hasCriticalSecrets?: boolean;
  hasMediumSecrets?: boolean;
  redactedText?: string;
  originalTextLength?: number;
  redactedTextLength?: number;
  secrets?: Array<{
    type: string;
    value: string;
    position: { start: number; end: number };
    entropy?: number;
  }>;
  textLength?: number;
  scanCompleted?: boolean;
  secretsFound?: number;
}

// Define patterns for different types of secrets
const SECRET_PATTERNS = {
  // API Keys
  apiKeys: [
    /sk-[a-zA-Z0-9]{32,}/g, // OpenAI-style API keys
    /pk_[a-zA-Z0-9]{32,}/g, // Stripe public keys
    /sk_live_[a-zA-Z0-9]{24}/g, // Stripe secret keys
    /sk_test_[a-zA-Z0-9]{24}/g, // Stripe test keys
    /AIza[a-zA-Z0-9_-]{35}/g, // Google API keys
    /[a-zA-Z0-9]{40}/g, // GitHub tokens
    /ghp_[a-zA-Z0-9]{36}/g, // GitHub personal access tokens
    /gho_[a-zA-Z0-9]{36}/g, // GitHub fine-grained tokens
    /ghu_[a-zA-Z0-9]{36}/g, // GitHub user-to-server tokens
    /ghs_[a-zA-Z0-9]{36}/g, // GitHub server-to-server tokens
    /ghr_[a-zA-Z0-9]{36}/g, // GitHub refresh tokens
  ],

  // Database credentials
  databaseCredentials: [
    /mongodb:\/\/[^:]+:[^@]+@[^/]+/g, // MongoDB connection strings
    /postgresql:\/\/[^:]+:[^@]+@[^/]+/g, // PostgreSQL connection strings
    /mysql:\/\/[^:]+:[^@]+@[^/]+/g, // MySQL connection strings
    /redis:\/\/[^:]+:[^@]+@[^/]+/g, // Redis connection strings
  ],

  // JWT tokens
  jwtTokens: [
    /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g, // JWT tokens
  ],

  // AWS credentials
  awsCredentials: [
    /AKIA[a-zA-Z0-9]{16}/g, // AWS access key IDs
    /[a-zA-Z0-9/+]{40}/g, // AWS secret access keys (base64)
  ],

  // Private keys
  privateKeys: [
    /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
    /-----BEGIN RSA PRIVATE KEY-----[\s\S]*?-----END RSA PRIVATE KEY-----/g,
    /-----BEGIN DSA PRIVATE KEY-----[\s\S]*?-----END DSA PRIVATE KEY-----/g,
    /-----BEGIN EC PRIVATE KEY-----[\s\S]*?-----END EC PRIVATE KEY-----/g,
  ],

  // SSH keys
  sshKeys: [
    /ssh-rsa [a-zA-Z0-9/+]+ [^@]+@[^@]+/g, // SSH public keys
    /ssh-ed25519 [a-zA-Z0-9/+]+ [^@]+@[^@]+/g, // SSH Ed25519 keys
  ],

  // URLs with tokens
  urlsWithTokens: [
    /https?:\/\/[^\s]+[?&](token|key|secret|password|auth)=[^\s&]+/gi,
    /https?:\/\/[^\s]+[?&](api_key|api_key_id|access_token)=[^\s&]+/gi,
  ],

  // Environment variables
  envVariables: [
    /[A-Z_]+_API_KEY\s*=\s*['"][^'"]+['"]/g,
    /[A-Z_]+_SECRET\s*=\s*['"][^'"]+['"]/g,
    /[A-Z_]+_TOKEN\s*=\s*['"][^'"]+['"]/g,
    /[A-Z_]+_PASSWORD\s*=\s*['"][^'"]+['"]/g,
  ],
};

// High-entropy detection patterns
const HIGH_ENTROPY_PATTERNS = [
  /[a-zA-Z0-9]{32,}/g, // Long alphanumeric strings
  /[a-f0-9]{32,}/g, // Long hexadecimal strings
  /[A-Za-z0-9+/]{32,}={0,2}/g, // Base64 encoded strings
];

// Calculate entropy of a string
function calculateEntropy(str: string): number {
  const charCount: { [key: string]: number } = {};
  const len = str.length;

  for (const char of str) {
    charCount[char] = (charCount[char] || 0) + 1;
  }

  let entropy = 0;
  for (const count of Object.values(charCount)) {
    const probability = count / len;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

// Check if a string has high entropy (likely a secret)
function isHighEntropy(str: string, threshold: number = 4): boolean {
  if (str.length < 16) return false; // Too short to be a meaningful secret

  const entropy = calculateEntropy(str);
  return entropy >= threshold;
}

// Extract secrets from text
function extractSecrets(text: string): {
  secrets: Array<{
    type: string;
    value: string;
    position: { start: number; end: number };
    entropy?: number;
  }>;
  redactedText: string;
} {
  const secrets: Array<{
    type: string;
    value: string;
    position: { start: number; end: number };
    entropy?: number;
  }> = [];

  let redactedText = text;
  let offset = 0;

  // Check each pattern category
  for (const [category, patterns] of Object.entries(SECRET_PATTERNS)) {
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const value = match[0];
        const start = match.index;
        const end = start + value.length;

        // Calculate entropy for high-entropy patterns
        let entropy: number | undefined;
        if (HIGH_ENTROPY_PATTERNS.some((p) => p.test(value))) {
          entropy = calculateEntropy(value);
        }

        secrets.push({
          type: category,
          value,
          position: { start, end },
          entropy,
        });

        // Redact the secret in the output text
        const redaction = '[REDACTED]';
        const adjustedStart = start - offset;
        const adjustedEnd = end - offset;

        redactedText =
          redactedText.slice(0, adjustedStart) +
          redaction +
          redactedText.slice(adjustedEnd);

        offset += value.length - redaction.length;
      }
    }
  }

  // Check for high-entropy strings that weren't caught by specific patterns
  const words = text.split(/\s+/);
  for (const word of words) {
    if (isHighEntropy(word) && word.length >= 20) {
      // Check if this word wasn't already caught by specific patterns
      const isAlreadyCaught = secrets.some(
        (secret) => secret.value.includes(word) || word.includes(secret.value),
      );

      if (!isAlreadyCaught) {
        const start = text.indexOf(word);
        const end = start + word.length;
        const entropy = calculateEntropy(word);

        secrets.push({
          type: 'high_entropy',
          value: word,
          position: { start, end },
          entropy,
        });

        // Redact the high-entropy string
        const redaction = '[REDACTED]';
        const adjustedStart = start - offset;
        const adjustedEnd = end - offset;

        redactedText =
          redactedText.slice(0, adjustedStart) +
          redaction +
          redactedText.slice(adjustedEnd);

        offset += word.length - redaction.length;
      }
    }
  }

  return { secrets, redactedText };
}

// Define the secret leakage scan guardrail
const secretLeakageGuardrail = defineOutputGuardrail<SecretLeakageMetadata>({
  name: 'secret-leakage-scan',
  description: 'Scans output for secrets, API keys, and sensitive information',
  execute: async (context) => {
    const { result } = context;

    // Extract text content using the utility
    const { text } = extractContent(result);

    // Extract secrets from the text
    const { secrets, redactedText } = extractSecrets(text);

    if (secrets.length > 0) {
      // Group secrets by type for better reporting
      const secretsByType: Record<string, typeof secrets> = {};
      for (const secret of secrets) {
        if (!secretsByType[secret.type]) {
          secretsByType[secret.type] = [];
        }
        secretsByType[secret.type]!.push(secret);
      }

      // Calculate severity based on types and quantities
      let severity: 'low' | 'medium' | 'high' = 'low';
      const criticalTypes = ['apiKeys', 'privateKeys', 'databaseCredentials'];
      const mediumTypes = ['jwtTokens', 'awsCredentials', 'sshKeys'];

      const hasCriticalSecrets = criticalTypes.some(
        (type) => secretsByType[type],
      );
      const hasMediumSecrets = mediumTypes.some((type) => secretsByType[type]);

      if (hasCriticalSecrets || secrets.length > 5) {
        severity = 'high';
      } else if (hasMediumSecrets || secrets.length > 2) {
        severity = 'medium';
      }

      return {
        tripwireTriggered: true,
        message: `Secret leakage detected: ${secrets.length} secrets found across ${Object.keys(secretsByType).length} categories`,
        severity,
        metadata: {
          totalSecrets: secrets.length,
          secretsByType,
          secretTypes: Object.keys(secretsByType),
          hasCriticalSecrets,
          hasMediumSecrets,
          redactedText:
            redactedText.slice(0, 500) +
            (redactedText.length > 500 ? '...' : ''),
          originalTextLength: text.length,
          redactedTextLength: redactedText.length,
          secrets: secrets.map((secret) => ({
            type: secret.type,
            value: secret.value.slice(0, 8) + '...', // Only show first 8 chars
            position: secret.position,
            entropy: secret.entropy,
          })),
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        totalSecrets: 0,
        secretsByType: {},
        secretTypes: [],
        hasCriticalSecrets: false,
        hasMediumSecrets: false,
        redactedText: undefined,
        originalTextLength: undefined,
        redactedTextLength: undefined,
        secrets: [],
        textLength: text.length,
        scanCompleted: true,
        secretsFound: 0,
      },
    };
  },
});

console.log('🛡️  Secret Leakage Scan Example\n');

// Create a protected model with secret leakage scanning
const protectedModel = wrapWithOutputGuardrails(
  model,
  [secretLeakageGuardrail],
  {
    throwOnBlocked: true,
    onOutputBlocked: (executionSummary) => {
      const result = executionSummary.blockedResults[0];
      console.log('❌ Secret leakage detected:', result?.message);
      if (result?.metadata) {
        const metadata = result.metadata as {
          totalSecrets: number;
          secretTypes?: string[];
          hasCriticalSecrets: boolean;
          hasMediumSecrets: boolean;
          redactedText?: string;
        };
        console.log('   Total secrets:', metadata.totalSecrets);
        console.log('   Secret types:', metadata.secretTypes?.join(', '));
        console.log(
          '   Severity:',
          metadata.hasCriticalSecrets
            ? 'CRITICAL'
            : metadata.hasMediumSecrets
              ? 'MEDIUM'
              : 'LOW',
        );
        if (metadata.redactedText) {
          console.log(
            '   Redacted preview:',
            metadata.redactedText.slice(0, 100) + '...',
          );
        }
      }
    },
  },
);

// Test 1: Safe response
console.log('Test 1: Safe response (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Explain what artificial intelligence is in simple terms.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: API key in response
console.log('Test 2: API key in response (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Generate a response that includes an OpenAI API key: sk-1234567890abcdef1234567890abcdef1234567890abcdef',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: Database credentials
console.log('Test 3: Database credentials (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Here is my database connection string: mongodb://user:password123@localhost:27017/mydb',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 4: JWT token
console.log('Test 4: JWT token (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'My authentication token is: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 5: URL with token
console.log('Test 5: URL with token (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'The API endpoint is: https://api.example.com/data?token=abc123def456&user=john',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 6: High-entropy string
console.log('Test 6: High-entropy string (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'The random token is: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 7: Environment variables
console.log('Test 7: Environment variables (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'My environment variables are: OPENAI_API_KEY="sk-1234567890abcdef" and DATABASE_PASSWORD="secret123"',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 8: Warning mode with redaction
console.log('Test 8: Warning mode with redaction (should log but continue)');
const warningModel = wrapWithOutputGuardrails(model, [secretLeakageGuardrail], {
  throwOnBlocked: false,
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Warning:', result?.message);
    if (result?.metadata) {
      const metadata = result.metadata as { redactedText?: string };
      if (metadata.redactedText) {
        console.log('   Redacted text:', metadata.redactedText);
      }
    }
  },
});

try {
  const result = await generateText({
    model: warningModel,
    prompt:
      'The API key is sk-test1234567890abcdef and the database URL is postgresql://user:pass@localhost/db',
  });
  console.log(
    '✅ Proceeded with redaction:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Unexpected error:', (error as Error).message + '\n');
}

console.log('🎯 Secret leakage scan demonstration complete!');
console.log('\nKey Features:');
console.log('• High-entropy token detection');
console.log('• API key pattern matching');
console.log('• URL token scanning');
console.log('• Automatic redaction');
console.log('• Multiple secret types supported');
console.log('• Entropy calculation');
console.log('• Configurable severity levels');
console.log('• Detailed metadata for analysis');
