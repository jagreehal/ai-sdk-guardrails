/**
 * SQL Code Safety Example
 *
 * Demonstrates how to ensure SQL code safety by blocking dangerous operations,
 * enforcing table allowlisting, requiring WHERE clauses, and restricting imports
 * and operations. This is critical for preventing SQL injection, data loss,
 * and unauthorized database access.
 */

import { generateText } from 'ai';
import { model } from './model';
import { defineOutputGuardrail, withGuardrails } from '../src/index';
import { extractContent } from '../src/guardrails/output';

// Define SQL safety patterns and rules
const SQL_PATTERNS = {
  // Dangerous SQL operations
  dangerousOperations: [
    /DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER|PROCEDURE|FUNCTION)/gi,
    /DELETE\s+FROM\s+\w+\s*(?!WHERE)/gi, // DELETE without WHERE
    /TRUNCATE\s+TABLE/gi,
    /ALTER\s+(TABLE|DATABASE|SCHEMA)/gi,
    /CREATE\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW|TRIGGER|PROCEDURE|FUNCTION)/gi,
    /GRANT\s+.*\s+TO/gi,
    /REVOKE\s+.*\s+FROM/gi,
    /EXEC\s*\(/gi,
    /EXECUTE\s*\(/gi,
    /sp_executesql/gi,
    /xp_cmdshell/gi,
    /BACKUP\s+DATABASE/gi,
    /RESTORE\s+DATABASE/gi,
    /BULK\s+INSERT/gi,
    /OPENROWSET/gi,
    /OPENDATASOURCE/gi,
    /OPENQUERY/gi,
  ],

  // High-risk operations that require careful review
  highRiskOperations: [
    /UPDATE\s+\w+\s+SET/gi,
    /INSERT\s+INTO/gi,
    /MERGE\s+INTO/gi,
    /UPSERT/gi,
    /REPLACE\s+INTO/gi,
    /LOAD\s+DATA/gi,
    /COPY\s+FROM/gi,
    /\bUNION\s+ALL\b/gi,
    /\bUNION\b/gi,
    /\bCROSS\s+JOIN\b/gi,
    /\bOUTER\s+JOIN\b/gi,
  ],

  // Required safety patterns
  requiredPatterns: [
    /WHERE\s+.*\s*=/gi, // WHERE clause with condition
    /WHERE\s+.*\s*IN\s*\(/gi, // WHERE clause with IN
    /WHERE\s+.*\s*LIKE/gi, // WHERE clause with LIKE
    /WHERE\s+.*\s*BETWEEN/gi, // WHERE clause with BETWEEN
    /LIMIT\s+\d+/gi, // LIMIT clause
    /TOP\s+\d+/gi, // TOP clause (SQL Server)
    /FETCH\s+FIRST\s+\d+/gi, // FETCH clause (SQL standard)
  ],

  // Table allowlist patterns
  allowedTables: [
    /users/i,
    /products/i,
    /orders/i,
    /customers/i,
    /inventory/i,
    /sales/i,
    /reports/i,
    /analytics/i,
    /logs/i,
    /audit/i,
  ],

  // Blocked table patterns
  blockedTables: [
    /system\./i,
    /sys\./i,
    /information_schema\./i,
    /performance_schema\./i,
    /mysql\./i,
    /pg_/i,
    /sqlite_/i,
    /temp_/i,
    /tmp_/i,
    /backup_/i,
    /archive_/i,
    /admin_/i,
    /root_/i,
    /master_/i,
    /config_/i,
    /settings_/i,
    /secrets_/i,
    /passwords_/i,
    /tokens_/i,
    /keys_/i,
  ],

  // SQL injection patterns
  injectionPatterns: [
    /'.*OR\s+.*=.*'/gi,
    /'.*AND\s+.*=.*'/gi,
    /'.*UNION\s+SELECT.*'/gi,
    /'.*DROP\s+TABLE.*'/gi,
    /'.*DELETE\s+FROM.*'/gi,
    /'.*UPDATE\s+.*SET.*'/gi,
    /'.*INSERT\s+INTO.*'/gi,
    /'.*EXEC\s*\(.*'/gi,
    /'.*xp_cmdshell.*'/gi,
    /'.*sp_executesql.*'/gi,
  ],

  // Comment patterns
  commentPatterns: [
    /--.*$/gm, // Single line comments
    /\/\*.*?\*\//gs, // Multi-line comments
    /#.*$/gm, // MySQL style comments
  ],

  // Function call patterns
  functionCalls: [
    /\bCOUNT\s*\(/gi,
    /\bSUM\s*\(/gi,
    /\bAVG\s*\(/gi,
    /\bMAX\s*\(/gi,
    /\bMIN\s*\(/gi,
    /\bCONCAT\s*\(/gi,
    /\bSUBSTRING\s*\(/gi,
    /\bUPPER\s*\(/gi,
    /\bLOWER\s*\(/gi,
    /\bTRIM\s*\(/gi,
    /\bDATE\s*\(/gi,
    /\bNOW\s*\(/gi,
    /\bGETDATE\s*\(/gi,
  ],
};

// Define safety thresholds
const SAFETY_THRESHOLDS = {
  maxQueryLength: 10_000, // Maximum query length
  maxTableCount: 10, // Maximum number of tables in a query
  maxFunctionCalls: 20, // Maximum number of function calls
  maxCommentLength: 500, // Maximum comment length
  requireWhereClause: true, // Whether to require WHERE clauses for UPDATE/DELETE
  requireLimit: true, // Whether to require LIMIT clauses for SELECT
  maxResultRows: 1000, // Maximum expected result rows
};

// Check for dangerous SQL operations
function detectDangerousOperations(sql: string): {
  detected: boolean;
  operations: string[];
  severity: 'critical' | 'high' | 'medium';
  riskLevel: number;
} {
  const operations: string[] = [];
  let severity: 'critical' | 'high' | 'medium' = 'medium';
  let riskLevel = 0;

  for (const pattern of SQL_PATTERNS.dangerousOperations) {
    const matches = sql.match(pattern);
    if (matches) {
      operations.push(...matches);
      riskLevel += 10; // High risk for dangerous operations
      severity = 'critical';
    }
  }

  for (const pattern of SQL_PATTERNS.highRiskOperations) {
    const matches = sql.match(pattern);
    if (matches) {
      operations.push(...matches);
      riskLevel += 5; // Medium risk for high-risk operations
      if (severity !== 'critical') {
        severity = 'high';
      }
    }
  }

  return {
    detected: operations.length > 0,
    operations,
    severity,
    riskLevel,
  };
}

// Check for required safety patterns
function checkRequiredSafety(sql: string): {
  hasWhereClause: boolean;
  hasLimit: boolean;
  hasSafetyMeasures: boolean;
  missingPatterns: string[];
  warnings: string[];
} {
  const missingPatterns: string[] = [];
  const warnings: string[] = [];

  // Check for WHERE clause in UPDATE/DELETE operations
  const hasUpdateDelete = /(UPDATE|DELETE)\s+.*\s+(SET|FROM)/gi.test(sql);
  const hasWhereClause = SQL_PATTERNS.requiredPatterns.some((pattern) =>
    pattern.test(sql),
  );

  if (
    hasUpdateDelete &&
    !hasWhereClause &&
    SAFETY_THRESHOLDS.requireWhereClause
  ) {
    missingPatterns.push('WHERE clause');
    warnings.push(
      'UPDATE/DELETE operations should include WHERE clause for safety',
    );
  }

  // Check for LIMIT clause in SELECT operations
  const hasSelect = /SELECT\s+.*\s+FROM/gi.test(sql);
  const hasLimit = /(LIMIT|TOP|FETCH)\s+\d+/gi.test(sql);

  if (hasSelect && !hasLimit && SAFETY_THRESHOLDS.requireLimit) {
    missingPatterns.push('LIMIT clause');
    warnings.push(
      'SELECT operations should include LIMIT clause to prevent large result sets',
    );
  }

  const hasSafetyMeasures = hasWhereClause || hasLimit;

  return {
    hasWhereClause,
    hasLimit,
    hasSafetyMeasures,
    missingPatterns,
    warnings,
  };
}

// Check table allowlist compliance
function checkTableAllowlist(sql: string): {
  isCompliant: boolean;
  allowedTables: string[];
  blockedTables: string[];
  unknownTables: string[];
  violations: string[];
} {
  const allowedTables: string[] = [];
  const blockedTables: string[] = [];
  const unknownTables: string[] = [];
  const violations: string[] = [];

  // Extract table names from SQL
  const tableMatches = sql.match(
    /(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(\w+)/gi,
  );
  const tables = tableMatches
    ? tableMatches.map((match) => {
        const parts = match.split(/\s+/);
        const lastPart = parts.at(-1);
        return lastPart ? lastPart.toLowerCase() : '';
      })
    : [];

  for (const table of tables) {
    // Check if table is in allowlist
    const isAllowed = SQL_PATTERNS.allowedTables.some((pattern) =>
      pattern.test(table),
    );
    const isBlocked = SQL_PATTERNS.blockedTables.some((pattern) =>
      pattern.test(table),
    );

    if (isAllowed) {
      allowedTables.push(table);
    } else if (isBlocked) {
      blockedTables.push(table);
      violations.push(`Blocked table access: ${table}`);
    } else {
      unknownTables.push(table);
      violations.push(`Unknown table: ${table} (not in allowlist)`);
    }
  }

  const isCompliant = blockedTables.length === 0 && unknownTables.length === 0;

  return {
    isCompliant,
    allowedTables,
    blockedTables,
    unknownTables,
    violations,
  };
}

// Check for SQL injection patterns
function detectSQLInjection(sql: string): {
  detected: boolean;
  patterns: string[];
  severity: 'critical' | 'high' | 'medium';
  confidence: number;
} {
  const patterns: string[] = [];
  let severity: 'critical' | 'high' | 'medium' = 'medium';
  let confidence = 0;

  for (const pattern of SQL_PATTERNS.injectionPatterns) {
    const matches = sql.match(pattern);
    if (matches) {
      patterns.push(...matches);
      confidence += 0.3; // High confidence for injection patterns
      severity = 'critical';
    }
  }

  // Check for suspicious string concatenation
  const suspiciousConcatenation = /'.*'[\s]*\+[\s]*'.*'/gi.test(sql);
  if (suspiciousConcatenation) {
    patterns.push('Suspicious string concatenation');
    confidence += 0.2;
    if (severity !== 'critical') {
      severity = 'high';
    }
  }

  // Check for dynamic SQL execution
  const dynamicSQL = /(EXEC|EXECUTE|sp_executesql)\s*\(/gi.test(sql);
  if (dynamicSQL) {
    patterns.push('Dynamic SQL execution');
    confidence += 0.4;
    severity = 'critical';
  }

  return {
    detected: patterns.length > 0,
    patterns,
    severity,
    confidence: Math.min(confidence, 1),
  };
}

// Analyze SQL complexity and structure
function analyzeSQLComplexity(sql: string): {
  complexity: 'low' | 'medium' | 'high';
  metrics: {
    queryLength: number;
    tableCount: number;
    functionCalls: number;
    commentLength: number;
    nestedLevels: number;
  };
  warnings: string[];
} {
  const warnings: string[] = [];

  const queryLength = sql.length;
  const tableCount = (
    sql.match(/(?:FROM|JOIN|UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(\w+)/gi) ||
    []
  ).length;
  const functionCalls = (sql.match(/[A-Z]+\s*\(/gi) || []).length;

  // Calculate comment length
  let commentLength = 0;
  for (const pattern of SQL_PATTERNS.commentPatterns) {
    const matches = sql.match(pattern);
    if (matches) {
      commentLength += matches.join('').length;
    }
  }

  // Calculate nested levels (simplified)
  const nestedLevels =
    (sql.match(/\(/g) || []).length - (sql.match(/\)/g) || []).length;

  // Determine complexity
  let complexity: 'low' | 'medium' | 'high' = 'low';
  let complexityScore = 0;

  if (queryLength > SAFETY_THRESHOLDS.maxQueryLength) {
    complexityScore += 3;
    warnings.push(
      `Query length (${queryLength}) exceeds maximum (${SAFETY_THRESHOLDS.maxQueryLength})`,
    );
  }

  if (tableCount > SAFETY_THRESHOLDS.maxTableCount) {
    complexityScore += 2;
    warnings.push(
      `Table count (${tableCount}) exceeds maximum (${SAFETY_THRESHOLDS.maxTableCount})`,
    );
  }

  if (functionCalls > SAFETY_THRESHOLDS.maxFunctionCalls) {
    complexityScore += 2;
    warnings.push(
      `Function calls (${functionCalls}) exceed maximum (${SAFETY_THRESHOLDS.maxFunctionCalls})`,
    );
  }

  if (commentLength > SAFETY_THRESHOLDS.maxCommentLength) {
    complexityScore += 1;
    warnings.push(
      `Comment length (${commentLength}) exceeds maximum (${SAFETY_THRESHOLDS.maxCommentLength})`,
    );
  }

  if (nestedLevels > 5) {
    complexityScore += 2;
    warnings.push(
      `High nesting level (${nestedLevels}) may indicate complex query`,
    );
  }

  if (complexityScore >= 5) {
    complexity = 'high';
  } else if (complexityScore >= 2) {
    complexity = 'medium';
  }

  return {
    complexity,
    metrics: {
      queryLength,
      tableCount,
      functionCalls,
      commentLength,
      nestedLevels,
    },
    warnings,
  };
}

// Main SQL safety validation function
function validateSQLSafety(sql: string): {
  isSafe: boolean;
  violations: string[];
  warnings: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  metadata: {
    dangerousOperations: {
      detected: boolean;
      operations: string[];
      severity: 'critical' | 'high' | 'medium';
      riskLevel: number;
    };
    safetyCompliance: {
      hasWhereClause: boolean;
      hasLimit: boolean;
      hasSafetyMeasures: boolean;
      missingPatterns: string[];
      warnings: string[];
    };
    tableAllowlist: {
      isCompliant: boolean;
      allowedTables: string[];
      blockedTables: string[];
      unknownTables: string[];
      violations: string[];
    };
    injectionDetection: {
      detected: boolean;
      patterns: string[];
      severity: 'critical' | 'high' | 'medium';
      confidence: number;
    };
    complexity: {
      complexity: 'low' | 'medium' | 'high';
      metrics: {
        queryLength: number;
        tableCount: number;
        functionCalls: number;
        commentLength: number;
        nestedLevels: number;
      };
      warnings: string[];
    };
  };
} {
  const violations: string[] = [];
  const warnings: string[] = [];
  let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

  // Check for dangerous operations
  const dangerousOps = detectDangerousOperations(sql);
  if (dangerousOps.detected) {
    violations.push(
      `Dangerous operations detected: ${dangerousOps.operations.join(', ')}`,
    );
    if (dangerousOps.severity === 'critical') {
      riskLevel = 'critical';
    } else if (dangerousOps.severity === 'high' && riskLevel === 'low') {
      riskLevel = 'high';
    }
  }

  // Check safety compliance
  const safetyCompliance = checkRequiredSafety(sql);
  if (!safetyCompliance.hasSafetyMeasures) {
    violations.push(
      `Missing safety measures: ${safetyCompliance.missingPatterns.join(', ')}`,
    );
    if (riskLevel !== 'critical') {
      riskLevel = 'high';
    }
  }
  warnings.push(...safetyCompliance.warnings);

  // Check table allowlist
  const tableAllowlist = checkTableAllowlist(sql);
  if (!tableAllowlist.isCompliant) {
    violations.push(
      `Table allowlist violations: ${tableAllowlist.violations.join(', ')}`,
    );
    if (riskLevel !== 'critical') {
      riskLevel = 'high';
    }
  }

  // Check for SQL injection
  const injectionDetection = detectSQLInjection(sql);
  if (injectionDetection.detected) {
    violations.push(
      `SQL injection patterns detected: ${injectionDetection.patterns.join(', ')}`,
    );
    riskLevel = 'critical';
  }

  // Analyze complexity
  const complexity = analyzeSQLComplexity(sql);
  if (complexity.complexity === 'high') {
    warnings.push(
      `High complexity query detected: ${complexity.warnings.join(', ')}`,
    );
    if (riskLevel === 'low') {
      riskLevel = 'medium';
    }
  }
  warnings.push(...complexity.warnings);

  return {
    isSafe: violations.length === 0,
    violations,
    warnings,
    riskLevel,
    metadata: {
      dangerousOperations: dangerousOps,
      safetyCompliance,
      tableAllowlist,
      injectionDetection,
      complexity,
    },
  };
}

// Define the SQL code safety guardrail
const sqlCodeSafetyGuardrail = defineOutputGuardrail<{
  sqlDetected: boolean;
  validation: ReturnType<typeof validateSQLSafety> | null;
  violations: string[];
  warnings: string[];
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
}>({
  name: 'sql-code-safety',
  description:
    'Ensures SQL code safety through dangerous operation blocking, table allowlisting, and injection detection',
  execute: async (context) => {
    const { text } = extractContent(context.result);

    // Check if text contains SQL
    const sqlKeywords =
      /(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|GRANT|REVOKE|EXEC|EXECUTE)/gi;
    const hasSQL = sqlKeywords.test(text);

    if (!hasSQL) {
      return {
        tripwireTriggered: false,
        metadata: {
          sqlDetected: false,
          validation: null,
          violations: [],
          warnings: [],
          riskLevel: 'low' as const,
        },
      };
    }

    // Validate SQL safety
    const validation = validateSQLSafety(text);

    if (!validation.isSafe) {
      return {
        tripwireTriggered: true,
        message: `SQL safety violation detected: ${validation.violations.length} violation(s), ${validation.warnings.length} warning(s).`,
        severity: validation.riskLevel as
          | 'low'
          | 'medium'
          | 'high'
          | 'critical',
        suggestion:
          'Review and modify SQL code to comply with safety requirements and remove dangerous operations.',
        metadata: {
          sqlDetected: true,
          validation,
          violations: validation.violations,
          warnings: validation.warnings,
          riskLevel: validation.riskLevel,
        },
      };
    }

    return {
      tripwireTriggered: false,
      metadata: {
        sqlDetected: true,
        validation,
        violations: [],
        warnings: validation.warnings,
        riskLevel: validation.riskLevel,
      },
    };
  },
});

console.log('🛡️  SQL Code Safety Example\n');

// Create a protected model with SQL safety enforcement
const protectedModel = withGuardrails(model, {
  outputGuardrails: [sqlCodeSafetyGuardrail],
  throwOnBlocked: true,
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('❌ SQL safety violation detected:', result?.message);
    if (result?.metadata) {
      const metadata = result.metadata;
      console.log('   Risk Level:', metadata.riskLevel);
      console.log(
        '   Violations:',
        (metadata.violations as string[])?.length || 0,
      );
      console.log('   Warnings:', (metadata.warnings as string[])?.length || 0);
      const validation = metadata.validation as ReturnType<
        typeof validateSQLSafety
      >;
      if (validation?.metadata?.dangerousOperations?.operations?.length > 0) {
        const operations = validation.metadata.dangerousOperations.operations;
        console.log(
          '   Dangerous Operations:',
          operations.slice(0, 3).join(', '),
        );
      }
    }
  },
});

// Test 1: Safe SELECT query (should pass)
console.log('Test 1: Safe SELECT query (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Write a safe SQL query to select user names from the users table with a limit of 10.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 2: Dangerous DROP operation (should be blocked)
console.log('Test 2: Dangerous DROP operation (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Write a SQL query to drop the users table.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 3: DELETE without WHERE clause (should be blocked)
console.log('Test 3: DELETE without WHERE clause (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Write a SQL query to delete all records from the users table.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 4: Blocked table access (should be blocked)
console.log('Test 4: Blocked table access (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Write a SQL query to access the system.users table.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 5: SQL injection pattern (should be blocked)
console.log('Test 5: SQL injection pattern (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Write a SQL query with string concatenation that could be vulnerable to injection.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 6: Complex query with warnings (should pass with warnings)
console.log('Test 6: Complex query with warnings (should pass with warnings)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Write a complex SQL query with multiple joins and functions.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 7: Dynamic SQL execution (should be blocked)
console.log('Test 7: Dynamic SQL execution (should be blocked)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Write a SQL query using EXEC or sp_executesql for dynamic execution.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Expected blocking:', (error as Error).message + '\n');
}

// Test 8: Safe UPDATE with WHERE clause (should pass)
console.log('Test 8: Safe UPDATE with WHERE clause (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt:
      'Write a safe SQL query to update user email with a WHERE clause and limit.',
  });
  console.log('✅ Success:', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

// Test 9: Warning mode with safety analysis
console.log('Test 9: Warning mode with safety analysis');
const warningModel = withGuardrails(model, {
  outputGuardrails: [sqlCodeSafetyGuardrail],
  throwOnBlocked: false,
  onOutputBlocked: (executionSummary) => {
    const result = executionSummary.blockedResults[0];
    console.log('⚠️  Warning:', result?.message);
    if (result?.metadata) {
      const metadata = result.metadata;
      console.log('   Risk Level:', metadata.riskLevel);
      if ((metadata.warnings as string[])?.length > 0) {
        console.log('   Primary Warning:', (metadata.warnings as string[])[0]);
      }
    }
  },
});

try {
  const result = await generateText({
    model: warningModel,
    prompt: 'Write a SQL query that might have some safety concerns.',
  });
  console.log(
    '✅ Proceeded with safety warning:',
    result.text.slice(0, 100) + '...\n',
  );
} catch (error) {
  console.log('❌ Unexpected error:', (error as Error).message + '\n');
}

// Test 10: Edge case - no SQL content
console.log('Test 10: Edge case - no SQL content (should pass)');
try {
  const result = await generateText({
    model: protectedModel,
    prompt: 'Explain the benefits of using prepared statements in SQL.',
  });
  console.log('✅ Success (no SQL):', result.text.slice(0, 100) + '...\n');
} catch (error) {
  console.log('❌ Error:', (error as Error).message + '\n');
}

console.log('🎯 SQL code safety guardrail demonstration complete!');
console.log('\nKey Features:');
console.log('• Dangerous SQL operation blocking');
console.log('• Table allowlisting and restrictions');
console.log('• WHERE clause enforcement');
console.log('• Import and operation restrictions');
console.log('• SQL injection pattern detection');
console.log('• Query complexity analysis');
console.log('• Safety compliance validation');
console.log('• Risk level assessment');
console.log('• Configurable safety thresholds');
console.log('• Detailed metadata for analysis');
