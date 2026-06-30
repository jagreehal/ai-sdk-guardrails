/**
 * Keeps `text` and `content` aligned on V4 generate results.
 *
 * AI SDK v7 derives user-visible text from `content`, not the top-level `text`
 * field. Output guardrails that mutate only one field are otherwise silently ignored.
 */

type TextContentPart = { type: string; text?: string };

export interface GenerateResultTextSnapshot {
  text?: string;
  contentJoined?: string;
}

function joinTextFromContent(content: unknown): string | undefined {
  if (!Array.isArray(content)) {
    return undefined;
  }

  const parts = content
    .filter(
      (part): part is TextContentPart =>
        typeof part === 'object' &&
        part !== null &&
        part.type === 'text' &&
        typeof part.text === 'string',
    )
    .map((part) => part.text as string);

  return parts.length > 0 ? parts.join('') : undefined;
}

export function snapshotGenerateResultText(
  result: unknown,
): GenerateResultTextSnapshot {
  const record = result as { text?: string; content?: unknown };
  return {
    text: typeof record.text === 'string' ? record.text : undefined,
    contentJoined: joinTextFromContent(record.content),
  };
}

export function syncGenerateResultTextAfterGuardrails<T>(
  result: T,
  before: GenerateResultTextSnapshot,
): T {
  const record = result as T & { text?: string; content?: TextContentPart[] };
  const afterContent = joinTextFromContent(record.content);
  const afterText = typeof record.text === 'string' ? record.text : undefined;

  const textChanged = afterText !== undefined && afterText !== before.text;
  const contentChanged =
    afterContent !== undefined && afterContent !== before.contentJoined;

  if (textChanged && !contentChanged && afterText !== undefined) {
    record.content = [{ type: 'text', text: afterText }];
    record.text = afterText;
    return result;
  }

  if (contentChanged && afterContent !== undefined) {
    record.text = afterContent;
    return result;
  }

  if (afterContent !== undefined) {
    record.text = afterContent;
  } else if (afterText !== undefined) {
    record.content = [{ type: 'text', text: afterText }];
  }

  return result;
}
