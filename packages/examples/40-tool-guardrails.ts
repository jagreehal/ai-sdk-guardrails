import { generateText, tool } from 'ai';
import { model } from './model';
import { z } from 'zod';
import {
  withGuardrails,
  allowedToolsGuardrail,
  toolEgressPolicy,
  type AllowedToolsOptions,
} from 'ai-sdk-guardrails';

console.log('🛡️  Comprehensive Tool Security Demo');
console.log('====================================\n');

// Define comprehensive tool set for security testing
const securityTools = {
  // Safe tools - generally allowed
  calculator: tool({
    description: 'Perform mathematical calculations',
    inputSchema: z.object({
      expression: z.string().describe('Mathematical expression to evaluate'),
    }),
    execute: async ({ expression }: { expression: string }) => {
      try {
        const result = eval(expression.replaceAll(/[^0-9+\-*/().\s]/g, ''));
        return { result: `${expression} = ${result}` };
      } catch {
        return { error: 'Invalid mathematical expression' };
      }
    },
  }),

  search: tool({
    description: 'Search the web for information',
    inputSchema: z.object({
      query: z.string().describe('Search query'),
    }),
    execute: async ({ query }: { query: string }) => {
      return `Search results for: ${query}`;
    },
  }),

  weather: tool({
    description: 'Get weather information for a location',
    inputSchema: z.object({
      location: z.string().describe('City or location name'),
    }),
    execute: async ({ location }: { location: string }) => {
      return {
        location,
        temperature: '22°C',
        condition: 'Sunny',
        humidity: '65%',
      };
    },
  }),

  // Sensitive tools - require special authorization
  sendEmail: tool({
    description: 'Send an email message',
    inputSchema: z.object({
      to: z.string().email().describe('Recipient email address'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body content'),
    }),
    execute: async ({
      to,
      subject,
    }: {
      to: string;
      subject: string;
      body: string;
    }) => {
      console.log(`📧 Mock email sent to ${to}: ${subject}`);
      return {
        status: 'Email sent successfully',
        messageId: 'msg_' + Date.now(),
      };
    },
  }),

  // Dangerous tools - should be restricted
  systemCommand: tool({
    description: 'Execute system commands (DANGEROUS - admin only)',
    inputSchema: z.object({
      command: z.string().describe('System command to execute'),
    }),
    execute: async ({ command }: { command: string }) => {
      console.log(`⚠️  System command blocked: ${command}`);
      return { error: 'System commands are not allowed' };
    },
  }),

  fileDelete: tool({
    description: 'Delete files from the filesystem (DANGEROUS)',
    inputSchema: z.object({
      path: z.string().describe('File path to delete'),
    }),
    execute: async ({ path }: { path: string }) => {
      console.log(`⚠️  File deletion blocked: ${path}`);
      return { error: 'File deletion is not allowed' };
    },
  }),

  dangerous: tool({
    description: 'This tool should be blocked',
    inputSchema: z.object({
      command: z.string().describe('Command to execute'),
    }),
    execute: async ({ command }: { command: string }) => {
      return `Executed: ${command}`;
    },
  }),
};

// Security policy configurations for different user roles
const securityPolicies = {
  // Standard user - limited tools
  standard: {
    allowedTools: ['calculator', 'weather', 'search'],
    deniedTools: ['systemCommand', 'fileDelete', 'sendEmail', 'dangerous'],
    detectNaturalLanguageTools: true,
  } as AllowedToolsOptions,

  // Business user - includes communication tools
  business: {
    allowedTools: ['calculator', 'weather', 'search', 'sendEmail'],
    deniedTools: ['systemCommand', 'fileDelete', 'dangerous'],
    detectNaturalLanguageTools: true,
    customValidator: (toolName: string) => {
      // Business hours validation for email
      if (
        toolName.toLowerCase().includes('email') ||
        toolName.toLowerCase().includes('send')
      ) {
        const hour = new Date().getHours();
        const isBusinessHours = hour >= 8 && hour <= 18;
        console.log(
          `🕐 Email tool access at ${hour}:00 - ${isBusinessHours ? 'Allowed' : 'Denied'} (business hours: 8-18)`,
        );
        return isBusinessHours;
      }
      return true;
    },
  } as AllowedToolsOptions,

  // Admin user - access to dangerous tools with extra validation
  admin: {
    allowedTools: [
      'calculator',
      'weather',
      'search',
      'sendEmail',
      'systemCommand',
      'fileDelete',
    ],
    deniedTools: ['dangerous'],
    detectNaturalLanguageTools: true,
    customValidator: (toolName: string) => {
      // Extra validation for dangerous tools
      if (
        ['systemcommand', 'filedelete', 'system', 'delete'].includes(
          toolName.toLowerCase(),
        )
      ) {
        console.log(
          `⚠️  Admin tool access requested: ${toolName} - Requires additional authorization`,
        );
        return true; // For demo purposes
      }
      return true;
    },
  } as AllowedToolsOptions,

  // Restricted - minimal tools allowed
  restricted: {
    allowedTools: ['calculator'],
    deniedTools: [
      'systemCommand',
      'fileDelete',
      'sendEmail',
      'dangerous',
      'search',
      'weather',
    ],
    detectNaturalLanguageTools: true,
  } as AllowedToolsOptions,
};

// Test cases for comprehensive security testing
const testCases = [
  'Calculate 15 * 8 + 23',
  "What's the weather like in New York?",
  'Search for information about TypeScript',
  'Send an email to john@example.com about the meeting',
  'Delete the file /tmp/test.txt',
  "Run the command 'ls -la'",
  'Please execute a system command to check disk space',
  'Use the dangerous tool to execute a command',
];

async function testSecurityPolicies() {
  console.log('🔐 Testing Security Policies');
  console.log('============================\n');

  for (const [policyName, policy] of Object.entries(securityPolicies)) {
    console.log(`\n📋 Testing ${policyName.toUpperCase()} security policy`);
    console.log('='.repeat(50));

    const secureModel = withGuardrails({
      model,
      inputGuardrails: [allowedToolsGuardrail(policy)],
      outputGuardrails: [
        toolEgressPolicy({
          allowedTools: policy.allowedTools,
          deniedTools: policy.deniedTools,
          scanForUrls: true,
          allowFileUrls: false,
          allowLocalhost: false,
        }),
      ],
    });

    for (const testCase of testCases) {
      try {
        const result = await generateText({
          model: secureModel,
          prompt: testCase,
          tools: securityTools,
        });

        console.log(`✅ "${testCase}"`);
        if (result.toolCalls && result.toolCalls.length > 0) {
          for (const call of result.toolCalls) {
            console.log(`   🔧 Tool used: ${call.toolName}`);
          }
        }
      } catch (error) {
        console.log(`❌ "${testCase}"`);
        console.log(`   🚫 Blocked: ${(error as Error).message}`);
      }
    }
  }
}

async function testNaturalLanguageDetection() {
  console.log('\n\n🔍 Testing Natural Language Tool Detection');
  console.log('==========================================\n');

  const nlModel = withGuardrails({
    model,
    inputGuardrails: [
      allowedToolsGuardrail({
        allowedTools: ['calculator', 'search'],
        deniedTools: ['dangerous', 'systemCommand', 'fileDelete'],
        detectNaturalLanguageTools: true,
        toolPatterns: [
          /use\s+the\s+(\w+)\s+tool/gi,
          /call\s+the\s+(\w+)\s+function/gi,
          /execute\s+(\w+)/gi,
          /run\s+(\w+)/gi,
          /delete\s+\w+/gi,
          /remove\s+\w+/gi,
          /destroy\s+\w+/gi,
        ],
      }),
    ],
  });

  const nlTestCases = [
    'Search for the best restaurants nearby',
    'Look up information about machine learning',
    'Delete all temporary files from the system',
    'Remove the old backup data',
    'Please destroy the test database',
    'Use the dangerous tool to help me',
    'Call the systemCommand function to check status',
  ];

  for (const testCase of nlTestCases) {
    try {
      await generateText({
        model: nlModel,
        prompt: testCase,
        tools: securityTools,
      });
      console.log(`✅ "${testCase}" - Allowed`);
    } catch (error) {
      console.log(`❌ "${testCase}" - Blocked: ${(error as Error).message}`);
    }
  }
}

async function testCustomValidation() {
  console.log('\n\n⚙️  Testing Custom Validation Logic');
  console.log('===================================\n');

  const customModel = withGuardrails({
    model,
    inputGuardrails: [
      allowedToolsGuardrail({
        allowedTools: ['calculator', 'search', 'sendEmail'],
        deniedTools: ['systemCommand', 'fileDelete', 'dangerous'],
        detectNaturalLanguageTools: true,
        customValidator: (toolName: string) => {
          // Simulate dynamic policy checking
          const isWeekend = [0, 6].includes(new Date().getDay());
          const hour = new Date().getHours();

          if (toolName.toLowerCase().includes('email')) {
            if (isWeekend) {
              console.log('📅 Weekend email restriction active');
              return false;
            }
            if (hour < 8 || hour > 20) {
              console.log('🌙 After-hours email restriction active');
              return false;
            }
          }

          return true;
        },
      }),
    ],
  });

  const customTestCases = [
    'Calculate the area of a circle with radius 5',
    'Search for information about AI',
    "Send an email to the team about tomorrow's meeting",
    'Use the systemCommand to check system status',
  ];

  for (const testCase of customTestCases) {
    try {
      await generateText({
        model: customModel,
        prompt: testCase,
        tools: securityTools,
      });
      console.log(`✅ "${testCase}" - Executed successfully`);
    } catch (error) {
      console.log(`❌ "${testCase}" - ${(error as Error).message}`);
    }
  }
}

async function testConfigurationValidation() {
  console.log('\n\n🔧 Testing Configuration Validation');
  console.log('===================================\n');

  // Test 1: Empty allowedTools should throw error
  try {
    withGuardrails({
      model,
      inputGuardrails: [
        allowedToolsGuardrail({
          allowedTools: [], // Empty array should throw error
        }),
      ],
    });
    console.log('❌ Empty allowedTools should have thrown an error');
  } catch (error) {
    console.log('✅ Configuration validation works:', (error as Error).message);
  }

  // Test 2: Valid configuration should work
  try {
    withGuardrails({
      model,
      inputGuardrails: [
        allowedToolsGuardrail({
          allowedTools: ['calculator'],
          deniedTools: ['dangerous'],
        }),
      ],
    });
    console.log('✅ Valid configuration accepted');
  } catch (error) {
    console.log('❌ Valid configuration rejected:', (error as Error).message);
  }
}

async function main() {
  try {
    await testSecurityPolicies();
    await testNaturalLanguageDetection();
    await testCustomValidation();
    await testConfigurationValidation();

    console.log('\n\n🎯 Comprehensive Tool Security Summary');
    console.log('======================================');
    console.log('✅ Multi-layered security with input and output guardrails');
    console.log(
      '✅ Role-based access control with different security policies',
    );
    console.log('✅ Natural language tool detection and blocking');
    console.log('✅ Custom validation with business logic (time-based, etc.)');
    console.log('✅ Configuration validation prevents insecure setups');
    console.log('✅ Comprehensive tool coverage (safe, sensitive, dangerous)');
    console.log('✅ Real-world security scenarios and test cases');
    console.log('✅ Integration with AI SDK tool execution pipeline');
  } catch (error) {
    console.error('Demo failed:', error);
  }
}

main().catch(console.error);
